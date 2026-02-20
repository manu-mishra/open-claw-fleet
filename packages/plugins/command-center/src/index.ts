import { createTasksTool } from "./tasks-tool";

interface PluginApi {
  registerTool(tool: unknown): void;
}

export default function register(api: PluginApi): void {
  api.registerTool(createTasksTool());
}
