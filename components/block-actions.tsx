import { cn, generateUUID } from '@/lib/utils';
import { ClockRewind, CopyIcon, PlayIcon, RedoIcon, UndoIcon, StopIcon } from './icons';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useCopyToClipboard } from 'usehooks-ts';
import { toast } from 'sonner';
import { ConsoleOutput, UIBlock } from './block';
import {
  Dispatch,
  memo,
  SetStateAction,
  startTransition,
  useCallback,
  useState,
  useRef,
} from 'react';

interface ExecutionContext {
  status: 'idle' | 'running' | 'completed' | 'failed';
  output: string | null;
  error: string | null;
}

interface BlockActionsProps {
  block: UIBlock;
  handleVersionChange: (type: 'next' | 'prev' | 'toggle' | 'latest') => void;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  mode: 'read-only' | 'edit' | 'diff';
  setConsoleOutputs: Dispatch<SetStateAction<Array<ConsoleOutput>>>;
}

export function RunCodeButton({
  block,
  setConsoleOutputs,
}: {
  block: UIBlock;
  setConsoleOutputs: Dispatch<SetStateAction<Array<ConsoleOutput>>>;
}) {
  const [pyodide, setPyodide] = useState<any>(null);
  const [executing, setExecuting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const executionTimeoutRef = useRef<NodeJS.Timeout>();
  const maxExecutionTime = 30000; // 30 seconds timeout

  const isPython = block.language === 'python';
  const codeContent = block.content;

  const updateConsoleOutput = useCallback(
    (runId: string, content: string | null, status: 'completed' | 'failed') => {
      setConsoleOutputs((prev) => {
        const index = prev.findIndex((output) => output.id === runId);
        if (index === -1) return prev;

        return [
          ...prev.slice(0, index),
          { id: runId, content, status },
          ...prev.slice(index + 1)
        ];
      });
    },
    [setConsoleOutputs],
  );

  const stopExecution = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    if (executionTimeoutRef.current) {
      clearTimeout(executionTimeoutRef.current);
    }
    
    setExecuting(false);
  }, []);

  const loadAndRunPython = useCallback(async () => {
    const runId = generateUUID();
    setExecuting(true);
    abortControllerRef.current = new AbortController();

    setConsoleOutputs((prev) => [
      ...prev,
      {
        id: runId,
        content: null,
        status: 'in_progress',
      },
    ]);

    // Set execution timeout
    executionTimeoutRef.current = setTimeout(() => {
      stopExecution();
      updateConsoleOutput(runId, 'Execution timeout - exceeded 30 seconds', 'failed');
    }, maxExecutionTime);

    try {
      let currentPyodideInstance = pyodide;

      if (isPython && !currentPyodideInstance) {
        // @ts-expect-error - pyodide is not defined
        const newPyodideInstance = await loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/',
        });

        setPyodide(newPyodideInstance);
        currentPyodideInstance = newPyodideInstance;
      }

      // Initialize output capture
      await currentPyodideInstance.runPythonAsync(`
        import sys
        import io
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
      `);

      // Run the actual code
      await currentPyodideInstance.runPythonAsync(codeContent);

      // Get both stdout and stderr
      const stdout = await currentPyodideInstance.runPythonAsync('sys.stdout.getvalue()');
      const stderr = await currentPyodideInstance.runPythonAsync('sys.stderr.getvalue()');

      const output = stdout + (stderr ? `\nErrors:\n${stderr}` : '');
      updateConsoleOutput(runId, output, stderr ? 'failed' : 'completed');

    } catch (error: any) {
      updateConsoleOutput(runId, `Error: ${error.message}`, 'failed');
    } finally {
      if (executionTimeoutRef.current) {
        clearTimeout(executionTimeoutRef.current);
      }
      setExecuting(false);
      abortControllerRef.current = null;
    }
  }, [pyodide, codeContent, isPython, setConsoleOutputs, updateConsoleOutput, stopExecution]);

  return (
    <div className="flex gap-1">
      <Button
        variant="outline"
        className="py-1.5 px-2 h-fit dark:hover:bg-zinc-700"
        onClick={() => {
          if (executing) {
            stopExecution();
          } else {
            startTransition(() => {
              loadAndRunPython();
            });
          }
        }}
        disabled={block.status === 'streaming'}
      >
        {executing ? <StopIcon size={18} /> : <PlayIcon size={18} />}
        {executing ? 'Stop' : 'Run'}
      </Button>
    </div>
  );
}

const PureBlockActions = memo(function PureBlockActions({
  block,
  handleVersionChange,
  currentVersionIndex,
  isCurrentVersion,
  mode,
  setConsoleOutputs,
}: BlockActionsProps) {
  const [_, copyToClipboard] = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    copyToClipboard(block.content);
    toast.success('Copied to clipboard!');
  }, [copyToClipboard, block.content]);

  const isDisabled = block.status === 'streaming';
  const isFirstVersion = currentVersionIndex === 0;

  return (
    <div className="flex flex-row gap-1">
      {block.kind === 'code' && (
        <RunCodeButton block={block} setConsoleOutputs={setConsoleOutputs} />
      )}

      {block.kind === 'text' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className={cn('p-2 h-fit !pointer-events-auto dark:hover:bg-zinc-700', {
                'bg-muted': mode === 'diff',
              })}
              onClick={() => handleVersionChange('toggle')}
              disabled={isDisabled || isFirstVersion}
            >
              <ClockRewind size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View changes</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="p-2 h-fit dark:hover:bg-zinc-700 !pointer-events-auto"
            onClick={() => handleVersionChange('prev')}
            disabled={isDisabled || isFirstVersion}
          >
            <UndoIcon size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>View previous version</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="p-2 h-fit dark:hover:bg-zinc-700 !pointer-events-auto"
            onClick={() => handleVersionChange('next')}
            disabled={isDisabled || isCurrentVersion}
          >
            <RedoIcon size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>View next version</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="p-2 h-fit dark:hover:bg-zinc-700"
            onClick={handleCopy}
            disabled={isDisabled}
          >
            <CopyIcon size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy to clipboard</TooltipContent>
      </Tooltip>
    </div>
  );
});

export const BlockActions = memo(PureBlockActions, (prevProps, nextProps) => {
  return (
    prevProps.block.status === nextProps.block.status &&
    prevProps.currentVersionIndex === nextProps.currentVersionIndex &&
    prevProps.isCurrentVersion === nextProps.isCurrentVersion
  );
});