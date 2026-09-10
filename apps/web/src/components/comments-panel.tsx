'use client';

import { useEffect, useState } from 'react';
import { Check, MessageSquare, X } from 'lucide-react';
import type { CommentThread } from '@collaby/shared';
import { Avatar, Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return new Date(iso).toLocaleDateString();
}

export function CommentsPanel({
  documentId,
  canComment,
  activeAnchorId,
  draftAnchor,
  onClose,
  onDraftResolved,
}: {
  documentId: string;
  canComment: boolean;
  activeAnchorId: string | null;
  draftAnchor: { anchorId: string; quotedText: string } | null;
  onClose: () => void;
  onDraftResolved: () => void;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftBody, setDraftBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setThreads(await api.get<CommentThread[]>(`/api/documents/${documentId}/comments`));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [documentId]);

  async function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!draftAnchor || draftBody.trim().length === 0) return;

    setBusy(true);
    try {
      await api.post(`/api/documents/${documentId}/comments`, {
        anchorId: draftAnchor.anchorId,
        body: draftBody.trim(),
        quotedText: draftAnchor.quotedText,
      });
      setDraftBody('');
      onDraftResolved();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(threadId: string) {
    if (replyBody.trim().length === 0) return;

    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) return;

    setBusy(true);
    try {
      await api.post(`/api/documents/${documentId}/comments`, {
        anchorId: thread.anchorId,
        parentId: threadId,
        body: replyBody.trim(),
      });
      setReplyBody('');
      setReplyTo(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(thread: CommentThread) {
    await api.post(`/api/comments/${thread.id}/resolve`, { resolved: !thread.resolved });
    await load();
  }

  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-night-600 bg-night-850 lg:w-[300px]">
      <div className="flex h-12 items-center justify-between border-b border-night-600 px-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-moon">
          <MessageSquare size={13} className="text-dusk" />
          Comments
          {open.length > 0 ? (
            <span className="font-mono text-[11px] text-dusk">{open.length}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
          className="flex h-7 w-7 items-center justify-center rounded-md text-dusk hover:bg-night-700 hover:text-moon"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {draftAnchor ? (
          <form
            onSubmit={submitDraft}
            className="rounded-lg border border-lull-400/40 bg-night-800 p-2.5"
          >
            {draftAnchor.quotedText ? (
              <p className="mb-2 border-l-2 border-lamp/60 pl-2 text-[12px] italic text-dusk">
                {draftAnchor.quotedText}
              </p>
            ) : null}

            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              placeholder="Leave a comment"
              autoFocus
              rows={3}
              className="w-full resize-none rounded-md border border-night-600 bg-night-850 p-2 text-[13px] text-moon placeholder:text-dusk focus:border-lull-400 focus:outline-none"
            />

            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={onDraftResolved}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" disabled={busy}>
                {busy ? <Spinner /> : null}
                Comment
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : null}

        {!loading && threads.length === 0 && !draftAnchor ? (
          <p className="px-1 py-6 text-[12.5px] leading-relaxed text-dusk">
            {canComment
              ? 'Select some text and use the comment button to start a thread.'
              : 'No comments on this page yet.'}
          </p>
        ) : null}

        {[...open, ...resolved].map((thread) => (
          <article
            key={thread.id}
            className={cn(
              'rounded-lg border p-2.5 transition-colors',
              thread.anchorId === activeAnchorId
                ? 'border-lull-400/50 bg-night-800'
                : 'border-night-600 bg-night-800/60',
              thread.resolved && 'opacity-60',
            )}
          >
            {thread.quotedText ? (
              <p className="mb-2 border-l-2 border-lamp/50 pl-2 text-[12px] italic text-dusk">
                {thread.quotedText}
              </p>
            ) : null}

            <div className="flex items-start gap-2">
              <Avatar
                name={thread.author.displayName}
                color={thread.author.avatarColor}
                url={thread.author.avatarUrl}
                size={20}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12.5px] font-medium text-moon">
                    {thread.author.displayName}
                  </span>
                  <span className="font-mono text-[10.5px] text-dusk">
                    {relativeTime(thread.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-haze">
                  {thread.body}
                </p>
              </div>

              {canComment ? (
                <button
                  type="button"
                  onClick={() => void toggleResolved(thread)}
                  aria-label={thread.resolved ? 'Reopen thread' : 'Resolve thread'}
                  title={thread.resolved ? 'Reopen thread' : 'Resolve thread'}
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded',
                    thread.resolved ? 'text-leaf' : 'text-dusk hover:bg-night-700 hover:text-moon',
                  )}
                >
                  <Check size={13} />
                </button>
              ) : null}
            </div>

            {thread.replies.map((reply) => (
              <div
                key={reply.id}
                className="mt-2.5 flex items-start gap-2 border-t border-night-700 pt-2.5"
              >
                <Avatar
                  name={reply.author.displayName}
                  color={reply.author.avatarColor}
                  url={reply.author.avatarUrl}
                  size={18}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[12px] font-medium text-moon">
                      {reply.author.displayName}
                    </span>
                    <span className="font-mono text-[10.5px] text-dusk">
                      {relativeTime(reply.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-haze">
                    {reply.body}
                  </p>
                </div>
              </div>
            ))}

            {canComment ? (
              replyTo === thread.id ? (
                <div className="mt-2.5">
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Reply"
                    autoFocus
                    rows={2}
                    className="w-full resize-none rounded-md border border-night-600 bg-night-850 p-2 text-[12.5px] text-moon placeholder:text-dusk focus:border-lull-400 focus:outline-none"
                  />
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => void submitReply(thread.id)}
                    >
                      Reply
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setReplyTo(thread.id)}
                  className="mt-2 text-[12px] text-dusk hover:text-lull-400"
                >
                  Reply
                </button>
              )
            ) : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
