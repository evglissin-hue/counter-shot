// What this device and browser can do. No permissions needed.

export interface ProbeResult {
  userAgent: string;
  browser: string;
  os: string;
  cores: number;
  memoryGb: number | null;
  screen: { width: number; height: number; dpr: number };
  touchPoints: number;
  finePointer: boolean;
  webgpu: {
    available: boolean;
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    fallbackAdapter?: boolean;
    features?: string[];
    limits?: Record<string, number>;
    note?: string;
  };
  webgl2: { available: boolean; renderer?: string; vendor?: string };
  wasm: { simd: boolean; threads: boolean; crossOriginIsolated: boolean };
  gamepads: number;
  pointerLock: boolean;
}

const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function browserName(ua: string): string {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg\/(\d+)/))) return `Edge ${m[1]}`;
  if ((m = ua.match(/OPR\/(\d+)/))) return `Opera ${m[1]}`;
  if ((m = ua.match(/Firefox\/(\d+)/))) return `Firefox ${m[1]}`;
  if ((m = ua.match(/CriOS\/(\d+)/))) return `Chrome iOS ${m[1]}`;
  if ((m = ua.match(/Chrome\/(\d+)/))) return `Chrome ${m[1]}`;
  if ((m = ua.match(/Version\/([\d.]+).*Safari/))) return `Safari ${m[1]}`;
  return "Unknown browser";
}

function osName(ua: string, touch: number): string {
  if (/iPhone/.test(ua)) return "iOS";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "iPadOS";
  if (/Mac OS X/.test(ua)) {
    // Browsers freeze the macOS version in the user agent at 10.15, so it says nothing.
    const m = ua.match(/Mac OS X (\d+[._]\d+)/);
    return m && !/^10[._]15/.test(m[1]) ? `macOS ${m[1].replace("_", ".")}` : "macOS";
  }
  if (/Windows NT 10/.test(ua)) return "Windows 10 or 11";
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}

export async function probe(): Promise<ProbeResult> {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints || 0;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const result: ProbeResult = {
    userAgent: ua,
    browser: browserName(ua),
    os: osName(ua, touch),
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    screen: { width: screen.width, height: screen.height, dpr: Math.round(devicePixelRatio * 100) / 100 },
    touchPoints: touch,
    finePointer: matchMedia("(pointer: fine)").matches,
    webgpu: { available: false },
    webgl2: { available: false },
    wasm: {
      simd: (() => {
        try {
          return WebAssembly.validate(SIMD_TEST);
        } catch {
          return false;
        }
      })(),
      threads: typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated === true,
      crossOriginIsolated: self.crossOriginIsolated === true,
    },
    gamepads: (() => {
      try {
        return (navigator.getGamepads?.() ?? []).filter(Boolean).length;
      } catch {
        return 0;
      }
    })(),
    pointerLock: "requestPointerLock" in Element.prototype,
  };

  try {
    // Chromium can tell the real OS version.
    const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ platform?: string; platformVersion?: string }> } }).userAgentData;
    if (uad) {
      const hi = await uad.getHighEntropyValues(["platformVersion"]);
      if (hi.platform === "macOS" && hi.platformVersion) result.os = `macOS ${hi.platformVersion.split(".").slice(0, 2).join(".")}`;
      if (hi.platform === "Windows" && hi.platformVersion) result.os = Number(hi.platformVersion.split(".")[0]) >= 13 ? "Windows 11" : "Windows 10";
    }
  } catch {
    // keep the guess from the user agent
  }

  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) {
      result.webgpu.note = "This browser has no WebGPU";
    } else {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) {
        result.webgpu.note = "WebGPU is present but gave no graphics adapter";
      } else {
        const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
        result.webgpu = {
          available: true,
          vendor: info?.vendor || undefined,
          architecture: info?.architecture || undefined,
          device: info?.device || undefined,
          description: info?.description || undefined,
          fallbackAdapter: (info as GPUAdapterInfo & { isFallbackAdapter?: boolean })?.isFallbackAdapter ?? undefined,
          features: [...adapter.features].sort(),
          limits: {
            maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
            maxBufferSize: adapter.limits.maxBufferSize,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
            maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
            maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
          },
        };
      }
    }
  } catch (err) {
    result.webgpu.note = `WebGPU check failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      result.webgl2 = {
        available: true,
        renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
        vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // leave as unavailable
  }
  return result;
}

/** Median frame interval over about half a second, as a refresh rate. Call while nothing heavy is drawing. */
export function measureRefresh(ms = 600): Promise<number> {
  return new Promise((resolve) => {
    const times: number[] = [];
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (last) times.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        // Too few frames means the device could not keep up even with an idle page: assume a 60 Hz screen.
        if (times.length < 5) return resolve(60);
        times.sort((a, b) => a - b);
        const hz = Math.round(1000 / times[Math.floor(times.length / 2)]);
        resolve(Math.max(30, Math.min(240, hz)));
      }
    };
    requestAnimationFrame(tick);
  });
}

/** One short line naming the graphics chip. */
export function gpuName(p: ProbeResult): string {
  const w = p.webgpu;
  if (w.available) {
    const parts = [w.description, w.vendor && w.architecture ? `${w.vendor} ${w.architecture}` : w.vendor].filter(Boolean);
    if (parts.length) return String(parts[0]);
  }
  return p.webgl2.renderer || "Unknown graphics";
}
