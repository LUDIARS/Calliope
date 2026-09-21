import { execFile } from 'node:child_process';

export const LLM_SIZE_MINUTES = {
  S: 60,
  M: 240,
  L: 720,
} as const;

const LLM_TIMEOUT_MS = 60_000;

export interface LlmEstimateInput {
  title: string;
  details: string | null;
}

export type LlmRunner = (command: string, args: string[], options: {
  cwd: string;
  timeoutMs: number;
}) => Promise<string>;

const defaultRunner: LlmRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  }, (error, stdout) => {
    if (error) {
      // execFile errors can embed argv (including the task prompt). Do not copy
      // command output or arguments into an exception that may reach logs.
      reject(new Error('LLM estimation process failed'));
      return;
    }
    resolve(stdout);
  });
});

export async function estimateWithLlm(
  input: LlmEstimateInput,
  options: { claudeBin: string; cwd: string; runner?: LlmRunner },
): Promise<{ effortMinutes: number; size: keyof typeof LLM_SIZE_MINUTES }> {
  const prompt = [
    'Classify the implementation effort as exactly one letter: S, M, or L.',
    'S is a small change, M is a multi-file feature, L is a broad subsystem change.',
    'Return only S, M, or L.',
    `Title: ${input.title}`,
    `Details: ${input.details ?? '(none)'}`,
  ].join('\n');
  const output = await (options.runner ?? defaultRunner)(
    options.claudeBin,
    ['-p', prompt],
    { cwd: options.cwd, timeoutMs: LLM_TIMEOUT_MS },
  );
  const size = output.trim().toUpperCase();
  if (size !== 'S' && size !== 'M' && size !== 'L') {
    throw new Error('LLM estimation returned invalid size');
  }
  return { effortMinutes: LLM_SIZE_MINUTES[size], size };
}
