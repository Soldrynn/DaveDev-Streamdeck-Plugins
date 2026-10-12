// Shared property-inspector behaviour: conditional fields and direct-connection last-result UI.
(() => {
  const { streamDeckClient, useSettings, useGlobalSettings } = window.SDPIComponents;

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
    // Settings changed inside this inspector aren't echoed back, so re-check local visibility.
    // This does not poll FiveM or reconnect to it.
    setInterval(() => void applyVisibility(), 300);
  }

  const panel = document.querySelector("[data-connection-status]");
  if (!panel) return;
  const title = document.querySelector("[data-connection-title]");
  const messageText = document.querySelector("[data-connection-message]");
  const instanceText = document.querySelector("[data-connection-instance]");
  const transmissionText = document.querySelector("[data-connection-transmission]");
  const testButton = document.querySelector("[data-connection-test]");
  const [getClientInstance] = useGlobalSettings("clientInstance");
  const phases = {
    idle: ["neutral", "No connection result yet"],
    connecting: ["warn", "Connecting…"],
    ready: ["good", "FiveM responded"],
    transmitted: ["good", "Command transmitted"],
    disconnected: ["bad", "Connection unavailable"]
  };
  const lastTransmissions = new Map();
  let clientInstance = "primary";
  let latestAt = -1;
  let refreshTimer;
  let testTimer;
  let testing = false;
  let testStartedAt = 0;

  function setTesting(value) {
    testing = value;
    testButton.disabled = value;
    testButton.textContent = value ? "Testing connection…" : "Test connection";
    if (!value) {
      clearTimeout(testTimer);
      testStartedAt = 0;
    }
  }
  function render(tone, heading, message) {
    panel.dataset.tone = tone;
    title.textContent = heading;
    // Plugin messages are text, never HTML.
    messageText.textContent = message;
    instanceText.textContent = clientInstance === "secondary"
      ? "Legacy secondary client · 127.0.0.1:29300"
      : "Primary client · 127.0.0.1:29200";
    const at = lastTransmissions.get(clientInstance);
    transmissionText.textContent = at === undefined
      ? "No command transmission reported in this inspector."
      : `Last transmission: ${new Date(at).toLocaleTimeString()}. Execution is not confirmed.`;
  }
  function selectInstance(value) {
    const next = value === "secondary" ? "secondary" : "primary";
    if (next === clientInstance) return;
    clientInstance = next;
    latestAt = -1;
    setTesting(false);
    render("neutral", "Checking connection status…", "Reading the selected client's last connection result.");
  }
  const ask = (event, details = {}) => streamDeckClient.send("sendToPlugin", { ...details, event });
  async function refreshStatus() {
    selectInstance(await getClientInstance());
    // A status read must never open a connection or run a command.
    await ask("connection-status");
  }
  function reportInspectorError() {
    setTesting(false);
    render("bad", "Status unavailable", "FiveDeck did not return a connection result. Check the plugin log, then try Test connection again.");
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    // Allow sdpi-components to save debounced fields before asking the plugin for its status.
    refreshTimer = setTimeout(() => void refreshStatus().catch(reportInspectorError), 350);
  }

  streamDeckClient.message.subscribe(message => {
    if (message.event === "didReceiveSettings" || message.event === "didReceiveGlobalSettings") {
      if (message.event === "didReceiveGlobalSettings") selectInstance(message.payload?.settings?.clientInstance);
      scheduleRefresh();
      return;
    }
    const status = message.payload;
    if (message.event !== "sendToPropertyInspector" || status?.event !== "connection-status") return;
    if (status.clientInstance !== clientInstance || !Object.hasOwn(phases, status.phase)) return;
    if (!Number.isFinite(status.at) || status.at < latestAt || typeof status.message !== "string") return;
    // Ignore a cached pre-test status if a settings refresh races with the handshake.
    if (testing && status.at < testStartedAt) return;
    latestAt = status.at;
    if (status.phase === "transmitted") lastTransmissions.set(clientInstance, status.at);
    const [tone, heading] = phases[status.phase];
    render(tone, heading, status.message);
    if (status.phase !== "connecting") setTesting(false);
  });

  for (const field of document.querySelectorAll("[setting]")) {
    field.addEventListener("valuechange", () => {
      // Drop stale feedback immediately when choosing the other FiveM instance.
      if (field.getAttribute("setting") === "clientInstance") selectInstance(field.value);
      scheduleRefresh();
    });
  }
  testButton.addEventListener("click", () => {
    if (testing) return;
    setTesting(true);
    testStartedAt = Date.now();
    render("warn", "Testing connection…", "Checking FiveM's Remote Console handshake. No command is sent.");
    // A missing plugin reply should not leave the test button disabled forever. This does not
    // retry or reconnect: a later test always requires another deliberate click.
    testTimer = setTimeout(reportInspectorError, 10_000);
    // Pin the handshake to the visible selection. The plugin must reject a mismatch
    // with its saved settings instead of probing the previously selected client.
    void ask("connection-test", { clientInstance }).catch(reportInspectorError);
  });
  void refreshStatus().catch(reportInspectorError);
})();
