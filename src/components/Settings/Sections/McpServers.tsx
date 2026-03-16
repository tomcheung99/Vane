'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, Unplug } from 'lucide-react';
import type { McpTransportType } from '@/lib/config/types';

interface McpServerEntry {
  type: McpTransportType;
  url: string;
  headers?: Record<string, string>;
  toolTimeout?: number;
}

type SaveConfigResponse = {
  message?: string;
  reconnected?: boolean;
  reconnectError?: string | null;
};

const McpSection = ({
  values,
}: {
  fields?: any;
  values: Record<string, McpServerEntry>;
}) => {
  const [servers, setServers] = useState<Record<string, McpServerEntry>>(
    values || {},
  );
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<McpTransportType>('sse');
  const [newUrl, setNewUrl] = useState('');
  const [newAuthHeader, setNewAuthHeader] = useState('');
  const [newTimeout, setNewTimeout] = useState('60');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editType, setEditType] = useState<McpTransportType>('sse');
  const [editUrl, setEditUrl] = useState('');
  const [editAuthHeader, setEditAuthHeader] = useState('');
  const [editTimeout, setEditTimeout] = useState('60');

  const saveServer = async (name: string, entry: McpServerEntry) => {
    setSavingKey(name);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `mcpServers.${name}`,
          value: entry,
        }),
      });

      const payload = await res.json().catch(() => ({} as SaveConfigResponse));

      if (!res.ok) throw new Error('Failed to save');

      setServers((prev) => ({ ...prev, [name]: entry }));
      if (payload.reconnected === false) {
        toast.warning(`MCP server "${name}" saved, but reconnect failed.`);
      } else {
        toast.success(`MCP server "${name}" saved and reconnected.`);
      }
    } catch {
      toast.error('Failed to save MCP server config.');
    } finally {
      setSavingKey(null);
    }
  };

  const removeServer = async (name: string) => {
    setSavingKey(name);
    try {
      const updated = { ...servers };
      delete updated[name];

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'mcpServers',
          value: updated,
        }),
      });

      const payload = await res.json().catch(() => ({} as SaveConfigResponse));

      if (!res.ok) throw new Error('Failed to save');

      setServers(updated);
      if (payload.reconnected === false) {
        toast.warning(`MCP server "${name}" removed, but reconnect failed.`);
      } else {
        toast.success(`MCP server "${name}" removed and MCP reloaded.`);
      }
    } catch {
      toast.error('Failed to remove MCP server.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const url = newUrl.trim();

    if (!name || !url) {
      toast.error('Name and URL are required.');
      return;
    }

    const entry: McpServerEntry = {
      type: newType,
      url,
      toolTimeout: parseInt(newTimeout) || 60,
    };

    if (newAuthHeader.trim()) {
      entry.headers = { Authorization: newAuthHeader.trim() };
    }

    await saveServer(name, entry);
    setNewName('');
    setNewType('sse');
    setNewUrl('');
    setNewAuthHeader('');
    setNewTimeout('60');
    setAdding(false);
  };

  const startEditing = (name: string, entry: McpServerEntry) => {
    setAdding(false);
    setEditingName(name);
    setEditType(entry.type);
    setEditUrl(entry.url);
    setEditAuthHeader(entry.headers?.Authorization || '');
    setEditTimeout(String(entry.toolTimeout || 60));
  };

  const cancelEditing = () => {
    setEditingName(null);
    setEditType('sse');
    setEditUrl('');
    setEditAuthHeader('');
    setEditTimeout('60');
  };

  const handleEditSave = async () => {
    if (!editingName) return;

    const url = editUrl.trim();
    if (!url) {
      toast.error('URL is required.');
      return;
    }

    const entry: McpServerEntry = {
      type: editType,
      url,
      toolTimeout: parseInt(editTimeout) || 60,
    };

    if (editAuthHeader.trim()) {
      entry.headers = { Authorization: editAuthHeader.trim() };
    }

    await saveServer(editingName, entry);
    cancelEditing();
  };

  const serverEntries = Object.entries(servers);

  return (
    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
      {serverEntries.length === 0 && !adding && (
        <p className="text-xs text-black/50 dark:text-white/50">
          No MCP servers configured. Add one to extend Vane with external tools.
        </p>
      )}

      {serverEntries.map(([name, entry]) => (
        <section
          key={name}
          className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80"
        >
          {editingName === name ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Unplug size={14} className="text-black/60 dark:text-white/60" />
                <h4 className="text-sm text-black dark:text-white font-medium">
                  Edit {name}
                </h4>
              </div>
              <p className="text-[11px] text-black/40 dark:text-white/40">
                Server name is currently fixed. Rename by removing and re-adding if needed.
              </p>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as McpTransportType)}
                className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
              >
                <option value="sse">SSE</option>
                <option value="streamableHttp">Streamable HTTP</option>
                <option value="http">HTTP (legacy alias)</option>
              </select>
              <input
                type="text"
                placeholder={editType === 'sse' ? 'SSE URL' : 'Streamable HTTP MCP URL'}
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
              />
              <input
                type="password"
                placeholder="Authorization header (optional, e.g. Bearer xxx)"
                value={editAuthHeader}
                onChange={(e) => setEditAuthHeader(e.target.value)}
                className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
              />
              <input
                type="number"
                placeholder="Tool timeout (seconds)"
                value={editTimeout}
                onChange={(e) => setEditTimeout(e.target.value)}
                className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleEditSave}
                  disabled={savingKey !== null}
                  className="rounded-lg bg-[#24A0ED] px-4 py-1.5 text-xs text-white hover:bg-opacity-85 transition-colors disabled:opacity-50"
                >
                  {savingKey === name ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    'Save Changes'
                  )}
                </button>
                <button
                  onClick={cancelEditing}
                  disabled={savingKey === name}
                  className="rounded-lg border border-light-200 px-4 py-1.5 text-xs text-black/60 hover:bg-light-secondary dark:border-dark-200 dark:text-white/60 dark:hover:bg-dark-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Unplug size={14} className="text-black/60 dark:text-white/60" />
                  <h4 className="text-sm text-black dark:text-white font-medium">
                    {name}
                  </h4>
                </div>
                <p className="text-[11px] text-black/50 dark:text-white/50 break-all">
                  {entry.url}
                </p>
                {entry.headers?.Authorization && (
                  <p className="text-[11px] text-black/40 dark:text-white/40">
                    Auth: ••••••••
                  </p>
                )}
                <p className="text-[11px] text-black/40 dark:text-white/40">
                  Transport: {entry.type === 'streamableHttp' ? 'STREAMABLE HTTP' : entry.type.toUpperCase()}
                </p>
                <p className="text-[11px] text-black/40 dark:text-white/40">
                  Timeout: {entry.toolTimeout || 30}s
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEditing(name, entry)}
                  disabled={savingKey === name}
                  className="p-1.5 rounded-lg text-black/50 hover:bg-light-secondary dark:text-white/50 dark:hover:bg-dark-secondary transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => removeServer(name)}
                  disabled={savingKey === name}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  {savingKey === name ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            </div>
          )}
        </section>
      ))}

      {adding ? (
        <section className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 space-y-3 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
          <h4 className="text-sm text-black dark:text-white font-medium">
            Add MCP Server
          </h4>
          <input
            type="text"
            placeholder="Server name (e.g. openmemory)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as McpTransportType)}
            className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
          >
            <option value="sse">SSE</option>
            <option value="streamableHttp">Streamable HTTP</option>
            <option value="http">HTTP (legacy alias)</option>
          </select>
          <input
            type="text"
            placeholder={newType === 'sse' ? 'SSE URL' : 'Streamable HTTP MCP URL'}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
          />
          <input
            type="password"
            placeholder="Authorization header (optional, e.g. Bearer xxx)"
            value={newAuthHeader}
            onChange={(e) => setNewAuthHeader(e.target.value)}
            className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
          />
          <input
            type="number"
            placeholder="Tool timeout (seconds)"
            value={newTimeout}
            onChange={(e) => setNewTimeout(e.target.value)}
            className="w-full rounded-lg border border-light-200 bg-light-secondary px-3 py-2 text-xs text-black dark:border-dark-200 dark:bg-dark-secondary dark:text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={savingKey !== null}
              className="rounded-lg bg-[#24A0ED] px-4 py-1.5 text-xs text-white hover:bg-opacity-85 transition-colors disabled:opacity-50"
            >
              {savingKey ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Save'
              )}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-light-200 px-4 py-1.5 text-xs text-black/60 hover:bg-light-secondary dark:border-dark-200 dark:text-white/60 dark:hover:bg-dark-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-light-200 px-4 py-2.5 text-xs text-black/50 hover:border-[#24A0ED] hover:text-[#24A0ED] transition-colors dark:border-dark-200 dark:text-white/50 dark:hover:border-[#24A0ED] dark:hover:text-[#24A0ED]"
        >
          <Plus size={14} />
          Add MCP Server
        </button>
      )}
    </div>
  );
};

export default McpSection;
