/** A remote exec/PTY session owns interruption until its cleanup finishes. */
let owners = 0;
export function remoteSignalActive(): boolean { return owners > 0; }
export function claimRemoteSignals(): () => void { owners++; return () => { owners--; }; }
