import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

function validServer(value) {
  if (typeof value !== "string" || value.length > 255) return false;
  const match = /^(\[[\da-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(value);
  if (!match || (match[2] && (+match[2] < 1 || +match[2] > 65535))) return false;
  const host = match[1];
  return host.startsWith("[") ? isIP(host.slice(1,-1)) === 6 : host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function createParties(db, {acceptedFriends, isBlocked}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_parties (id TEXT PRIMARY KEY, host TEXT NOT NULL, server TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS play_expiry ON play_parties(expires);
    CREATE TABLE IF NOT EXISTS play_members (player TEXT PRIMARY KEY, party TEXT NOT NULL REFERENCES play_parties(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS play_member_party ON play_members(party);
    CREATE TABLE IF NOT EXISTS play_invites (party TEXT NOT NULL REFERENCES play_parties(id) ON DELETE CASCADE, player TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(party,player));
    CREATE TABLE IF NOT EXISTS play_shares (player TEXT PRIMARY KEY REFERENCES play_members(player) ON DELETE CASCADE,
      address TEXT NOT NULL, lease TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS play_invited_player ON play_invites(player);
  `);
  const membership = player => db.prepare("SELECT p.* FROM play_members m JOIN play_parties p ON p.id=m.party WHERE m.player=?").get(player);
  const members = party => db.prepare("SELECT u.id, u.minecraft_username name,s.address server FROM play_members m JOIN social_users u ON u.id=m.player LEFT JOIN play_shares s ON s.player=m.player AND s.expires>? WHERE m.party=? ORDER BY lower(u.minecraft_username)").all(Date.now(),party);
  function leave(player, party) {
    if (party.host === player) db.prepare("DELETE FROM play_parties WHERE id=?").run(party.id);
    else db.prepare("DELETE FROM play_members WHERE player=?").run(player);
  }
  function separate(first, second) {
    const party = membership(first);
    if (party && membership(second)?.id === party.id) leave(party.host === first ? second : first, party);
    db.prepare("DELETE FROM play_invites WHERE (player=? AND party IN (SELECT party FROM play_members WHERE player=?)) OR (player=? AND party IN (SELECT party FROM play_members WHERE player=?))").run(first,second,second,first);
  }
  const allowed = (party, player) => acceptedFriends(party.host,player) && members(party.id).every(member => !isBlocked(member.id,player));
  function change(player, body) {
    const party = membership(player);
    if (body.action === "create") {
      if (!party) {
        const id = randomUUID();
        db.prepare("INSERT INTO play_parties(id,host,expires) VALUES(?,?,?)").run(id,player,Date.now()+86400000);
        db.prepare("INSERT INTO play_members VALUES(?,?)").run(player,id);
        db.prepare("DELETE FROM play_invites WHERE player=?").run(player);
      }
    } else if (body.action === "accept" || body.action === "decline") {
      const target = db.prepare("SELECT p.* FROM play_invites i JOIN play_parties p ON p.id=i.party WHERE i.party=? AND i.player=? AND i.expires>?").get(body.partyId,player,Date.now());
      if (!target) return "Invitation expired.";
      if (body.action === "accept") {
        if (party || !allowed(target,player) || members(target.id).length >= 8) return "You cannot join this party.";
        db.prepare("INSERT INTO play_members VALUES(?,?)").run(player,target.id);
        db.prepare("DELETE FROM play_invites WHERE player=?").run(player);
      } else db.prepare("DELETE FROM play_invites WHERE party=? AND player=?").run(target.id,player);
    } else {
      if (!party || party.id !== body.partyId) return "Your party has changed.";
      if (body.action === "leave") leave(player,party);
      else if (body.action === "share") {
        if (!validServer(body.server) || typeof body.lease !== "string" || body.lease.length !== 36) return "Invalid server share.";
        db.prepare("INSERT OR REPLACE INTO play_shares VALUES(?,?,?,?)").run(player,body.server,body.lease,Date.now()+30000);
      } else if (body.action === "renew") {
        if (!db.prepare("UPDATE play_shares SET expires=? WHERE player=? AND lease=? AND expires>?").run(Date.now()+30000,player,body.lease,Date.now()).changes) return "Share ended.";
      } else if (body.action === "stop") {
        if (body.lease) db.prepare("DELETE FROM play_shares WHERE player=? AND lease=?").run(player,body.lease);
        else db.prepare("DELETE FROM play_shares WHERE player=?").run(player);
      } else if (party.host !== player) return "Only the host can do that.";
      else if (body.action === "invite") {
        if (!allowed(party,body.friendId) || membership(body.friendId) || members(party.id).length >= 8) return "That friend cannot join this party.";
        db.prepare("INSERT INTO play_invites VALUES(?,?,?) ON CONFLICT(party,player) DO UPDATE SET expires=excluded.expires").run(party.id,body.friendId,Date.now()+600000);
      } else return "Enter a valid Minecraft server address.";
    }
    return null;
  }
  function handle(player,body) {
    const expired = db.prepare("SELECT 1 FROM play_parties WHERE expires<=? LIMIT 1").get(Date.now());
    db.exec(body || expired ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      if (expired) db.prepare("DELETE FROM play_parties WHERE expires<=?").run(Date.now());
      let error;
      if (body) {
        if ((body.action !== "create" && typeof body.partyId !== "string") || (body.action === "invite" && typeof body.friendId !== "string")) error="Invalid party request.";
        else error=change(player,body);
      }
      const party = membership(player);
      const invites = db.prepare("SELECT p.*,i.expires inviteExpiry,u.minecraft_username name FROM play_invites i JOIN play_parties p ON p.id=i.party JOIN social_users u ON u.id=p.host WHERE i.player=? AND i.expires>?").all(player,Date.now()).filter(p=>allowed(p,player)).map(p=>({id:p.id,name:p.name,expires:p.inviteExpiry}));
      const state = { party: party && {id:party.id, host:party.host, members:members(party.id), invited:party.host===player?db.prepare("SELECT player FROM play_invites WHERE party=? AND expires>?").all(party.id,Date.now()).map(i=>i.player):[]}, invites };
      db.exec("COMMIT");
      return error ? {error} : state;
    } catch(e) { db.exec("ROLLBACK"); throw e; }
  }
  return {handle,separate};
}
