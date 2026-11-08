import { useEffect, useRef, useState } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import api from "../api";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const getPosition = () =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  });

export default function CameraCheckIn({ onDone }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOpen(false);
  };

  useEffect(
    () => () => streamRef.current?.getTracks().forEach((t) => t.stop()),
    [],
  );

  useEffect(() => {
  if (open && videoRef.current && streamRef.current) {
    videoRef.current.srcObject = streamRef.current;
  }
}, [open]);

  const start = async () => {
    setError("");
    setStatus("Loading face detector...");
    try {
      if (!detectorRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM);
        detectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL },
          runningMode: "IMAGE",
        });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      setOpen(true);
      setStatus('Starting camera...');
    } catch {
      setStatus("");
      setError("Could not open the camera. Please allow camera access.");
    }
  };

  const capture = async () => {
    setError("");
    setBusy(true);
    try {
      const video = videoRef.current;
      if (
        !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        setError(
          "Camera is still starting. Wait a second and press Capture again.",
        );
        return;
      }
      const faces = detectorRef.current.detect(video).detections.length;
      if (faces !== 1) {
        setError(
          faces === 0
            ? "No face detected. Try again."
            : "More than one face detected.",
        );
        return;
      }

      setStatus("Getting your location...");
      const pos = await getPosition();
      await api.post("/attendance/camera-check-in", {
        faces,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });

      stop();
      setStatus("");
      onDone();
    } catch (err) {
      if (err.response) {
        setError(err.response.data?.error || "Request failed");
      } else if (err.code === 1) {
        setError(
          "Location permission denied. Allow location in the browser site settings.",
        );
      } else if (err.code === 2) {
        setError(
          "Location is unavailable. Turn on device location (Windows: Settings, Privacy, Location).",
        );
      } else if (err.code === 3) {
        setError("Location timed out. Try again, or use your phone.");
      } else {
        setError(`Camera or detector error: ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!open && <button onClick={start}>Camera check-in</button>}
      {open && (
        <div className="panel">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedData={() => setStatus('Look at the camera, then press Capture.')}
            style={{ width: "100%", maxWidth: 360, borderRadius: 8 }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={busy} onClick={capture}>
              {busy ? "Checking..." : "Capture and check in"}
            </button>
            <button className="secondary" onClick={stop}>
              Cancel
            </button>
          </div>
          <small>Only the result is sent. No photo is stored.</small>
        </div>
      )}
      {status && <p>{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
