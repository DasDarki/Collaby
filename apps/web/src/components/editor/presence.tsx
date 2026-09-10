'use client';

import type { PresenceUser } from '@collaby/shared';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

export function PresenceStack({ peers, limit = 4 }: { peers: PresenceUser[]; limit?: number }) {
  const visible = peers.slice(0, limit);
  const overflow = peers.length - visible.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {visible.map((peer) => (
          <Avatar
            key={peer.clientId}
            name={peer.displayName}
            color={peer.avatarColor}
            url={peer.avatarUrl}
            size={22}
            ring
          />
        ))}
      </div>

      {overflow > 0 ? (
        <span className="ml-2 font-mono text-[11px] text-dusk">+{overflow}</span>
      ) : null}
    </div>
  );
}

export interface RailMark {
  clientId: number;
  displayName: string;
  color: string;
  offset: number;
}

export function PresenceRail({ marks }: { marks: RailMark[] }) {
  if (marks.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 hidden h-full w-[var(--rail-width)] rounded-full bg-night-600/45 lg:block"
    >
      {marks.map((mark) => (
        <span
          key={mark.clientId}
          title={mark.displayName}
          className={cn(
            'absolute left-0 h-6 w-full rounded-full transition-[top] duration-300 ease-out',
          )}
          style={{
            top: `calc(${Math.min(100, Math.max(0, mark.offset * 100))}% - 10px)`,
            backgroundColor: mark.color,
            boxShadow: `0 0 8px ${mark.color}66`,
          }}
        />
      ))}
    </div>
  );
}
