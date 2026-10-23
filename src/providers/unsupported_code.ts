/** An explicit absence of a verified interpreter transport. Never guesses HTTP routes. */
import type { CodeInterpreterProtocol } from "../protocol/contracts.js";
import { ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
export class UnsupportedCodeProtocol implements CodeInterpreterProtocol {
  readonly operations: ReadonlySet<string> = new Set();
  constructor(readonly provider: string) {}
  async runCode(..._args: Parameters<CodeInterpreterProtocol["runCode"]>): Promise<never> { throw new ProviderFeatureNotSupportedError(this.provider,"code.execute"); }
  async createContext(..._args: Parameters<CodeInterpreterProtocol["createContext"]>): Promise<never> { throw new ProviderFeatureNotSupportedError(this.provider,"code.context.create"); }
  async listContexts(..._args: Parameters<CodeInterpreterProtocol["listContexts"]>): Promise<never> { throw new ProviderFeatureNotSupportedError(this.provider,"code.context.list"); }
  async restartContext(..._args: Parameters<CodeInterpreterProtocol["restartContext"]>): Promise<never> { throw new ProviderFeatureNotSupportedError(this.provider,"code.context.restart"); }
  async removeContext(..._args: Parameters<CodeInterpreterProtocol["removeContext"]>): Promise<never> { throw new ProviderFeatureNotSupportedError(this.provider,"code.context.delete"); }
}
