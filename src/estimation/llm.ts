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
  }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(`LLM estimation failed: ${error.message}${stderr ? ` (${stderr.slice(0, 200)})` : ''}`));
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
    throw new Error(`LLM estimation returned invalid size: ${output.slice(0, 100)}`);
  }
  return { effortMinutes: LLM_SIZE_MINUTES[size], size };
}
