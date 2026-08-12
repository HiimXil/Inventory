"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

// The Barcode Detection API isn't part of TypeScript's bundled DOM types yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

export type BarcodeScannerStatus = "starting" | "scanning" | "error";

export type BarcodeScannerState = {
  status: BarcodeScannerStatus;
  error: string | null;
};

/**
 * Camera capture + code detection only — reports every decoded code as fast
 * as the camera produces it (dozens of times a second while a QR sits in
 * frame), with no debounce and no haptic feedback of its own. A scan no
 * longer mutates any quantity by itself (see lib/offline/scan-entry.ts), so
 * "is this detection meaningful" is entirely the caller's call: it decides
 * whether to open/update the quantity-entry panel and whether to vibrate,
 * based on panel state this hook knows nothing about.
 */
export function useBarcodeScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onDetect: (code: string) => void,
): BarcodeScannerState {
  const [state, setState] = useState<BarcodeScannerState>({ status: "starting", error: null });
  const onDetectRef = useRef(onDetect);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let animationFrame: number | null = null;
    let zxingControls: IScannerControls | null = null;

    async function startNativeDetector(video: HTMLVideoElement, Detector: BarcodeDetectorConstructor) {
      const detector = new Detector({ formats: ["qr_code"] });
      setState({ status: "scanning", error: null });

      const loop = async () => {
        if (stopped) return;
        try {
          const results = await detector.detect(video);
          if (results.length > 0) onDetectRef.current(results[0].rawValue);
        } catch {
          // Transient per-frame detection errors are expected; keep scanning.
        }
        animationFrame = requestAnimationFrame(() => void loop());
      };
      animationFrame = requestAnimationFrame(() => void loop());
    }

    async function startZxingFallback(video: HTMLVideoElement) {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (stopped) return;
      const reader = new BrowserQRCodeReader();
      setState({ status: "scanning", error: null });
      zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result) onDetectRef.current(result.getText());
      });
    }

    async function start() {
      const video = videoRef.current;
      if (!video) return;

      setState({ status: "starting", error: null });

      const hasNativeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

      try {
        if (hasNativeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
          });
          if (stopped) return;
          video.srcObject = stream;
          await video.play();
          const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor })
            .BarcodeDetector;
          await startNativeDetector(video, Detector);
        } else {
          await startZxingFallback(video);
        }
      } catch (error) {
        if (stopped) return;
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Impossible d'accéder à la caméra pour scanner un code.",
        });
      }
    }

    void start();

    return () => {
      stopped = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [videoRef]);

  return state;
}
