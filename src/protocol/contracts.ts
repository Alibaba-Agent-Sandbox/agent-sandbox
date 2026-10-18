/** Structural data-plane and lifecycle contracts. No backend implementation is imported at runtime. */
import type { SandboxConfig, SandboxInfo, SandboxStatus } from "../models/sandbox.js";
import type { ProcessChunk, ProcessInfo } from "../models/process.js";
import type { StreamReader } from "../transport/streaming.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../transport/auth_contract.js";
import type { FileInfo, WatchEvent } from "../models/filesystem.js";

export interface ListOptions {
    status?: SandboxStatus | null;
    limit?: number;
    offset?: number;
}

export interface SandboxProtocol {
    create(config: SandboxConfig, opts?: {
        request_timeout?: number | null;
    }): Promise<SandboxInfo>;
    list(opts?: ListOptions): Promise<SandboxInfo[]>;
    listV2(opts?: ListOptions): Promise<SandboxInfo[]>;
    getInfo(sandbox_id: string): Promise<SandboxInfo>;
    kill(sandbox_id: string): Promise<void>;
    setTimeout(sandbox_id: string, timeout: number): Promise<void>;
    connect(sandbox_id: string): Promise<SandboxInfo>;
    isRunning(sandbox_id: string): Promise<boolean>;
    pause(sandbox_id: string): Promise<void>;
    resume(sandbox_id: string): Promise<void>;
}

export interface ProcessStartOptions {
    cmd: string;
    args?: string[] | null;
    env?: Record<string, string> | null;
    cwd?: string;
    timeout?: number;
    user?: string;
}

export interface ProcessProtocol {
    start(envd_url: string, envd_token: EnvdTokenManager, opts: ProcessStartOptions): Promise<StreamReader<ProcessChunk>>;
    listProcesses(envd_url: string, envd_token: EnvdTokenManager): Promise<ProcessInfo[]>;
    connectToProcess(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
    }): Promise<StreamReader<ProcessChunk>>;
    update(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
        [key: string]: unknown;
    }): Promise<Record<string, any>>;
    sendInput(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
        data: string;
    }): Promise<void>;
    sendSignal(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
        signal?: number;
        request_timeout?: number | null;
    }): Promise<void>;
    sendStdin(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
        data: string;
    }): Promise<void>;
    kill(envd_url: string, envd_token: EnvdTokenManager, opts: {
        pid: number | bigint | string;
    }): Promise<void>;
}

export interface FilesystemProtocol {
    stat(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<FileInfo>;
    listDir(envd_url: string, envd_token: EnvdTokenManager, opts?: {
        path?: string;
    }): Promise<FileInfo[]>;
    makeDir(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<void>;
    remove(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<void>;
    move(envd_url: string, envd_token: EnvdTokenManager, opts: {
        source: string;
        destination: string;
    }): Promise<void>;
    watchDir(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<StreamReader<WatchEvent>>;
    uploadFile(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
        content: Uint8Array;
        username?: string;
    }): Promise<void>;
    downloadFile(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
        username?: string;
    }): Promise<Uint8Array>;
    exists(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<boolean>;
    getInfo(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<FileInfo>;
    read(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
    }): Promise<Uint8Array>;
    readText(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
        encoding?: unknown;
    }): Promise<string>;
    write(envd_url: string, envd_token: EnvdTokenManager, opts: {
        path: string;
        content: string | Uint8Array;
    }): Promise<void>;
    rename(envd_url: string, envd_token: EnvdTokenManager, opts: {
        old_path: string;
        new_path: string;
    }): Promise<void>;
}

export interface RunCodeOptions {
    code: string;
    language?: string;
    context_id?: string | null;
    timeout?: number;
    envs?: Record<string, string> | null;
    on_stdout?: ((s: string) => void) | null;
    on_stderr?: ((s: string) => void) | null;
    on_result?: ((r: any) => void) | null;
}

export interface CodeInterpreterProtocol {
    runCode(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager, opts: RunCodeOptions): Promise<Record<string, any>>;
    createContext(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager, opts?: {
        language?: string;
    }): Promise<Record<string, any>>;
    listContexts(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager): Promise<Record<string, any>[]>;
    restartContext(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager, opts: {
        context_id: string;
    }): Promise<Record<string, any>>;
    removeContext(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager, opts: {
        context_id: string;
    }): Promise<void>;
}

export interface TerminalSession {
    send(data: string): Promise<void>;
    sendBytes(data: Uint8Array): Promise<void>;
    receive(timeout?: number | null): Promise<string | Uint8Array>;
    outputStream(): AsyncGenerator<string | Uint8Array>;
    resize(cols: number, rows: number): Promise<void>;
    readonly is_connected: boolean;
    close(): Promise<void>;
}
