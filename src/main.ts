import { DataApi } from "./api/dataApi.js";
import { protocol } from "./wasm/protocol.js";

export { DataApi, protocol };

export type { DecodedResult } from "./api/dataApi.js";

export type { ErrorCode, ReceiveOptions, SendOptions, TransportApi, TransportError, TransportState, TransportWarning, WarningCode } from "./api/transportApi.js";

export type { BrowserRuntimeApi, CameraOptions, RenderQrOptions } from "./api/browserRuntimeApi.js";

export { isWorkerContext, setupWorkerSelfListener } from "./utils/worker.js";
