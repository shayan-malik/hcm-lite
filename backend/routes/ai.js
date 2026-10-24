import { Router } from 'express';
import pool from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { callLLM } from '../utils/llm.js';
import { toolDefinitions, executeTool } from '../utils/aiTools.js';
import { getToday } from '../utils/attendance.js';
import { resolveFilters, getHrDashboard, getAdminDashboard } from '../utils/analytics.js';

const router = Router();
router.use(authenticate);

const LIMIT_PER_HOUR = 20;
const LABEL = 'AI-generated';
const FRIENDLY_ERROR = 'The AI assistant is unavailable right now. Please try again in a moment.';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const POLICY = `
- Office starts at 09:00 with a 15 minute grace time. Check-in after 09:15 is "late".
- Working less than 5 hours is a "half_day". No record and no approved leave is "absent". No check-out is "missing_checkout".
- Weekend is Saturday and Sunday. One attendance record per employee per day.
- Leave quotas per year: annual 14, sick 8, casual 10, unpaid unlimited. Only working days count (weekends and public holidays are skipped).
- Overlapping leave or leave above the balance is rejected. HR approves or rejects leave.
- Payroll: gross = 1.5 x basic (HRA 40%, medical 10%). Per day = gross / working days of the month.
  Deductions: absent days, unpaid leave days and 0.5 day per half day. Joiners and leavers are prorated.
  Tax is calculated on gross x 12: 0 up to 600k; 5% to 1.2M; 30k + 15% to 2.4M; 210k + 25% to 3.6M; 510k + 35% above.
- HR prepares the monthly payroll, only Admin can finalize it, and finalized payroll is locked.`;

const systemPrompt = (user, today) => `You are the HCM Lite assistant. The signed-in user's role is "${user.role}". Today is ${today}.
Rules:
- For any question about company data, call the tools and answer ONLY from their results. Never guess or invent numbers.
- If the tools cannot answer, say you do not know.
- Never reveal another employee's data, especially salary, to an Employee. If a tool says access is denied, politely refuse.
- For policy questions, answer ONLY from the policy below. If it is not covered, say you do not know.
- Reply in the same language the user writes in (English, Urdu or Roman Urdu). Keep answers short.
Company policy:${POLICY}`;

const logAi = (userId, prompt, tool, response) =>
  pool
    .query('INSERT INTO ai_logs (user_id, prompt, tool_used, response) VALUES ($1, $2, $3, $4)', [
      userId, prompt, tool, response,
    ])
    .catch(() => {});

// About 20 AI requests per user per hour
const rateLimit = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ai_logs
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.user.id]
    );
    if (result.rows[0].n >= LIMIT_PER_HOUR) {
      return res.status(429).json({ error: 'AI limit reached (20 requests per hour). Please try again later.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Only user/assistant text from the browser is trusted as history
const cleanHistory = (history) =>
  (Array.isArray(history) ? history : [])
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

// ---------- Chat with tools ----------
router.post('/chat', rateLimit, async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'message is required' });

  const toolsUsed = [];
  try {
    const today = await getToday();
    const messages = [
      { role: 'system', content: systemPrompt(req.user, today) },
      ...cleanHistory(req.body.history),
      { role: 'user', content: message },
    ];

    let reply = null;
    for (let round = 0; round < 4 && !reply; round++) {
      const msg = await callLLM({ messages, tools: toolDefinitions });

      if (!msg.tool_calls?.length) {
        reply = msg.content;
        break;
      }

      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        toolsUsed.push(call.function.name);
        // Same services and permission checks as the REST API, for this user
        const result = await executeTool(call.function.name, args, req.user);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    reply = reply || 'Sorry, I could not complete that request. Please try rephrasing.';
    await logAi(req.user.id, message, toolsUsed.join(',') || null, reply);
    res.json({ reply, label: LABEL, tools: toolsUsed });
  } catch (err) {
    await logAi(req.user.id, message, toolsUsed.join(',') || null, `ERROR: ${err.message}`);
    res.status(503).json({ error: FRIENDLY_ERROR });
  }
});

// ---------- Dashboard summary (Admin + HR) ----------
router.post('/summary', authorize('admin', 'hr'), rateLimit, async (req, res) => {
  try {
    const filters = await resolveFilters(req.body || {});
    let facts;

    if (req.user.role === 'admin') {
      const d = await getAdminDashboard(filters);
      facts = {
        kpis: d.kpis,
        headcountByDepartment: d.headcountByDepartment,
        averageGrossByDepartment: d.averageGrossByDepartment,
      };
    } else {
      const d = await getHrDashboard(filters);
      facts = {
        kpis: d.kpis,
        attendanceSummary: d.attendance.summary,
        topLateComers: d.attendance.topLateComers,
        leaveByType: d.leave.byType,
      };
    }
    facts.filters = { from: filters.from, to: filters.to, department_id: filters.departmentId };

    const msg = await callLLM({
      messages: [
        {
          role: 'system',
          content:
            'You write short HR dashboard insights. Write 3 to 5 bullet points using ONLY the numbers in the JSON. Never invent numbers. If data is empty, say so.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    });

    await logAi(req.user.id, 'dashboard summary', 'summary', msg.content);
    res.json({ summary: msg.content, label: LABEL });
  } catch (err) {
    await logAi(req.user.id, 'dashboard summary', 'summary', `ERROR: ${err.message}`);
    res.status(err.status || 503).json({ error: err.status ? err.message : FRIENDLY_ERROR });
  }
});

// ---------- Smart leave: sentence to a pre-filled form (never saves) ----------
router.post('/smart-leave', authorize('employee', 'hr'), rateLimit, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const today = await getToday();
    const types = (await pool.query('SELECT id, name FROM leave_types ORDER BY id')).rows;

    // Calendar for the next 3 weeks, so the model does not do date math
    const calendar = [];
    const cursor = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < 22; i++) {
      calendar.push(`${cursor.toISOString().slice(0, 10)} ${DAY_NAMES[cursor.getUTCDay()]}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const system = `Convert the leave request into JSON: {"type": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": string}.
Allowed types: ${types.map((t) => t.name).join(', ')}. Use sick for illness, casual for weddings, events and personal work, annual for vacation or travel.
"next <weekday>" means the first such weekday after today. Use only dates from this calendar (first line is today):
${calendar.join('\n')}
Reply with JSON only.`;

    let parsed = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const msg = await callLLM({
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        json: true,
      });
      try {
        const candidate = JSON.parse(msg.content);
        const type = types.find((t) => t.name === String(candidate.type).toLowerCase());
        const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
        if (type && dateOk(candidate.start) && dateOk(candidate.end) && candidate.end >= candidate.start) {
          parsed = {
            leave_type_id: type.id,
            type: type.name,
            start_date: candidate.start,
            end_date: candidate.end,
            reason: String(candidate.reason || '').slice(0, 200),
          };
        }
      } catch {
        // invalid JSON, retry once
      }
    }

    if (!parsed) {
      await logAi(req.user.id, text, 'smart_leave', 'ERROR: invalid output');
      return res.status(422).json({ error: 'Could not understand the request. Please use the form.' });
    }

    await logAi(req.user.id, text, 'smart_leave', JSON.stringify(parsed));
    res.json({ ...parsed, label: LABEL });
  } catch (err) {
    await logAi(req.user.id, text, 'smart_leave', `ERROR: ${err.message}`);
    res.status(503).json({ error: FRIENDLY_ERROR });
  }
});

export default router;