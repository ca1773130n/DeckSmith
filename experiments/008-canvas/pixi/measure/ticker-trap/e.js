import { Application, Ticker } from "pixi.js";
window.mk = async (canvas) => {
  const app = new Application();
  await app.init({ canvas, width: 400, height: 200, background: "#000" });
  window.app = app;
  window.Ticker = Ticker;
};
