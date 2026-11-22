import { useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import type { History, Thread } from "../services/ask-delight";

type Props = {
  history: History;
  sessionThreads: ReadonlySet<string>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRemove: (id?: string) => void;
  onSetSaving: (save: boolean) => void;
};

type HistoryRow = { thread: Thread; title: string };
const dayLabels = ["Today", "Yesterday", "Earlier"] as const;
const chatTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const chatDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function AlulaHistory({ history, sessionThreads, onNew, onSelect, onRemove, onSetSaving }: Props) {
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups: HistoryRow[][] = [[], [], []];
  const query = search.trim().toLocaleLowerCase();
  let matches = 0;

  for (const thread of history.threads) {
    const title = thread.messages.find(message => message.role === "question")?.text.replace(/\s+/g, " ").trim() || "New chat";
    if (query && !title.toLocaleLowerCase().includes(query)) continue;
    const day = thread.updated >= today.getTime() ? 0 : thread.updated >= yesterday.getTime() ? 1 : 2;
    groups[day].push({ thread, title });
    matches += 1;
  }


  return <section className="ask-history" aria-labelledby="alula-history-title">
    <button className="desktop-create" type="button" onClick={() => { setSearch(""); onNew(); }}><Plus size={17} />New chat</button>
    <div className="ask-history-heading">
      <h2 id="alula-history-title">Recent chats</h2>
      <button className="ask-history-manage" type="button" aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? "alula-history-settings" : undefined}
        onClick={() => { setSettingsOpen(!settingsOpen); setConfirm(false); }}>Manage</button>
    </div>
    {settingsOpen && <div className="ask-history-settings" id="alula-history-settings">
      <label><span>Don’t save chats</span><input type="checkbox" checked={!history.save} onChange={event => onSetSaving(!event.currentTarget.checked)} /></label>
      <p>{history.save
        ? "Up to 50 chats are kept on this device for 30 days. Chat files are unencrypted."
        : "New chats stay in this session. Previously saved chats remain on this device until deleted."}</p>
      {history.threads.length > 0 && (confirm
        ? <div className="ask-confirm" role="group" aria-label="Confirm clear history">
            <p>Delete all chats on this device for this account?</p>
            <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
            <button type="button" className="ask-history-danger" onClick={() => { onRemove(); setConfirm(false); setSearch(""); }}>Delete all chats</button>
          </div>
        : <button type="button" className="ask-history-clear" onClick={() => setConfirm(true)}>Clear all history</button>)}
    </div>}
    {(history.threads.length > 0 || search) && <label className="ask-history-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" aria-label="Search chat titles" placeholder="Search chats…" value={search} onChange={event => setSearch(event.currentTarget.value)} />
    </label>}
    {matches === 0 && <p className="ask-history-empty" role="status">{query ? "No matching chats." : "No recent chats."}</p>}
    {groups.map((rows, day) => rows.length > 0 && <section className="ask-history-group" key={dayLabels[day]}>
      <h3>{dayLabels[day]}</h3>
      <ul>{rows.map(({ thread, title }) => <li key={thread.id} className="ask-history-row" data-current={thread.id === history.selected}>
        <button className="ask-thread" type="button" onClick={() => onSelect(thread.id)} aria-current={thread.id === history.selected ? "true" : undefined}>
          <span>{title}</span>
          <small>{sessionThreads.has(thread.id) ? "This session" : (day < 2 ? chatTime : chatDate).format(thread.updated)}</small>
        </button>
        <button className="ask-icon ask-thread-delete" type="button" aria-label={`Delete chat: ${title.slice(0, 60)}`} title="Delete chat" onClick={() => onRemove(thread.id)}><Trash2 size={15} /></button>
      </li>)}</ul>
    </section>)}
  </section>;
}
