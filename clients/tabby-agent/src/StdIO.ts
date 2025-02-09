import { AgentFunction, AgentEvent, Agent, agentEventNames } from "./Agent";
import { rootLogger } from "./logger";
import { splitLines, isCanceledError } from "./utils";

type AgentFunctionRequest<T extends keyof AgentFunction> = [
  id: number,
  data: {
    func: T;
    args: Parameters<AgentFunction[T]>;
  },
];

type CancellationRequest = [
  id: number,
  data: {
    func: "cancelRequest";
    args: [id: number];
  },
];

type StdIORequest = AgentFunctionRequest<any> | CancellationRequest;

type AgentFunctionResponse<T extends keyof AgentFunction> = [
  id: number, // Matched request id
  data: ReturnType<AgentFunction[T]>,
];

type AgentEventNotification = [
  id: 0, // Always 0
  data: AgentEvent,
];

type CancellationResponse = [
  id: number, // Matched request id
  data: boolean,
];

type StdIOResponse = AgentFunctionResponse<any> | AgentEventNotification | CancellationResponse;

/**
 * Every request and response should be single line JSON string and end with a newline.
 */
export class StdIO {
  private readonly process: NodeJS.Process = process;
  private readonly inStream: NodeJS.ReadStream = process.stdin;
  private readonly outStream: NodeJS.WriteStream = process.stdout;
  private readonly logger = rootLogger.child({ component: "StdIO" });

  private buffer: string = "";
  private abortControllers: { [id: string]: AbortController } = {};

  private agent: Agent | null = null;

  constructor() {}

  private async handleInput(data: Buffer) {
    const input = data.toString();
    this.buffer += input;
    const lines = splitLines(this.buffer);
    if (lines.length < 1) {
      return;
    }
    if (lines[lines.length - 1].endsWith("\n")) {
      this.buffer = "";
    } else {
      this.buffer = lines.pop()!;
    }
    for (const line of lines) {
      let request: StdIORequest | null = null;
      try {
        request = JSON.parse(line) as StdIORequest;
      } catch (error) {
        this.logger.error({ error }, `Failed to parse request: ${line}`);
        continue;
      }
      this.logger.debug({ request }, "Received request");
      const response = await this.handleRequest(request);
      this.sendResponse(response);
      this.logger.debug({ response }, "Sent response");
    }
  }

  private async handleRequest(request: StdIORequest): Promise<StdIOResponse> {
    let requestId: number = 0;
    const response: StdIOResponse = [0, null];
    const abortController = new AbortController();
    try {
      if (!this.agent) {
        throw new Error(`Agent not bound.\n`);
      }
      requestId = request[0];
      response[0] = requestId;

      const funcName = request[1].func;
      if (funcName === "cancelRequest") {
        response[1] = this.cancelRequest(request as CancellationRequest);
      } else {
        const func = this.agent[funcName];
        if (!func) {
          throw new Error(`Unknown function: ${funcName}`);
        }
        const args = request[1].args;
        // If the last argument is an object and has `signal` property, replace it with the abort signal.
        if (args.length > 0 && typeof args[args.length - 1] === "object" && args[args.length - 1]["signal"]) {
          this.abortControllers[requestId] = abortController;
          args[args.length - 1]["signal"] = abortController.signal;
        }
        response[1] = await func.apply(this.agent, args);
      }
    } catch (error) {
      if (isCanceledError(error)) {
        this.logger.debug({ error, request }, `Request canceled`);
      } else {
        this.logger.error({ error, request }, `Failed to handle request`);
      }
    } finally {
      if (this.abortControllers[requestId]) {
        delete this.abortControllers[requestId];
      }
      return response;
    }
  }

  private cancelRequest(request: CancellationRequest): boolean {
    const targetId = request[1].args[0];
    const controller = this.abortControllers[targetId];
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  private sendResponse(response: StdIOResponse): void {
    this.outStream.write(JSON.stringify(response) + "\n");
  }

  bind(agent: Agent): void {
    this.agent = agent;
    for (const eventName of agentEventNames) {
      this.agent.on(eventName, (event) => {
        this.sendResponse([0, event]);
      });
    }
  }

  listen() {
    this.inStream.on("data", this.handleInput.bind(this));

    ["SIGTERM", "SIGINT"].forEach((sig) => {
      this.process.on(sig, async () => {
        if (this.agent && this.agent.getStatus() !== "finalized") {
          await this.agent.finalize();
        }
        this.process.exit(0);
      });
    });
  }
}
