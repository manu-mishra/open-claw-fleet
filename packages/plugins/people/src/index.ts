import { createPeopleTool } from "./people-tool";

interface PluginApi {
  registerTool(tool: unknown): void;
}

export default function register(api: PluginApi): void {
  api.registerTool(createPeopleTool());
}
