// One slow factory tool, run in its own process for the MCP server (see forkJob in mcp.js).
// It gets the call over IPC, sends back the reply, and never writes to the MCP channel.
import { jobs, setVersion, text } from "./mcp.js";

process.once("message", async ({ name, root, client, version, args }) => {
  setVersion(version);
  process.env.FACTORY_MCP = "1";
  let reply;
  try {
    reply = await jobs[name]({ root, client, args });
  } catch (error) {
    reply = text(`The factory hit an error: ${error?.message ?? error}`, true);
  }
  process.send({ reply }, () => process.disconnect());
});
