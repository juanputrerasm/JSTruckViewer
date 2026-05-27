import { TruckViewerApp } from "./viewer-app.js";

// Boot the viewer. URL-based auto-loading is handled inside TruckViewerApp via ?file= / ?url=.
const app = new TruckViewerApp(document);
app.mount();
