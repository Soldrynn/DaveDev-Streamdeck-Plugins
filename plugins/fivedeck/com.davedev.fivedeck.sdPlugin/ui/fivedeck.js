// Shared property-inspector behaviour: conditional sections and the bridge status panel.
(() => {
  const { streamDeckClient, useSettings } = window.SDPIComponents;

  // <div data-when="mode" data-is="toggle,hold"> is shown only while the setting matches.
  const conditional = [...document.querySelectorAll("[data-when]")];
  const getters = new Map();
  for (const element of conditional) {
    const name = element.dataset.when;
    if (!getters.has(name)) getters.set(name, useSettings(name)[0]);
  }
  async function applyVisibility() {
    for (const element of conditional) {
      const value = await getters.get(element.dataset.when)();
      const current = value === undefined || value === null || value === "" ? element.dataset.default ?? "" : String(value);
      element.hidden = !element.dataset.is.split(",").includes(current);
    }
  }
  if (conditional.length) {
    void applyVisibility();
    // Settings changed inside this inspector aren't echoed back, so re-check on a short timer.
    setInterval(() => void applyVisibility(), 300);
  }

  const panel = document.querySelector("[data-bridge-status]");
  if (!panel) return;
  const describe = status => {
    if (status.platform !== "win32") return ["warn", "Game control needs Windows. Server features still work."];
    const fivem = status.fivem ? "FiveM found." : "FiveM.exe not found; set its location below.";
    if (status.state === "installed") return ["good", `Bridge ready: ${status.key} runs FiveDeck's commands. ${fivem}`];
    if (status.state === "conflict") return ["bad", `${status.key} is already bound to something else in FiveM. Choose another bridge key.`];
    if (status.gameRunning) return ["warn", `Bridge not installed yet. FiveDeck types the bind into F8 on your first command. ${fivem}`];
    return ["warn", `Bridge not installed yet. Use the button below or run a command in-game. ${fivem}`];
  };
  streamDeckClient.message.subscribe(message => {
    if (message.event !== "sendToPropertyInspector" || message.payload?.event !== "bridge-status") return;
    const [tone, text] = describe(message.payload);
    panel.dataset.tone = tone;
    panel.textContent = text;
  });
  const ask = event => streamDeckClient.send("sendToPlugin", { event });
  ask("bridge-status");
  document.querySelector("[data-bridge-install]")?.addEventListener("click", () => ask("bridge-install"));
})();
