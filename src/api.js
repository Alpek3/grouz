// GrouZ — couche d'accès Supabase
// npm i @supabase/supabase-js
// .env : VITE_SUPABASE_URL=...  VITE_SUPABASE_ANON_KEY=...
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } } // reste connecté
);

const ok = ({ data, error }) => { if (error) throw error; return data; };

// ── AUTH ────────────────────────────────────────────────────────
export const signUp = ({ email, password, pseudo, name, age, gender, bio = "" }) =>
  supabase.auth.signUp({ email, password, options: { data: { pseudo, name, age, gender, bio } } }).then(ok);

export const signIn = ({ email, password }) =>
  supabase.auth.signInWithPassword({ email, password }).then(ok);

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession().then(r => r.data.session);

export const onAuthChange = (cb) =>
  supabase.auth.onAuthStateChange((_e, session) => cb(session)).data.subscription;

// ── PROFILS ─────────────────────────────────────────────────────
export const getProfile = (id) =>
  supabase.from("profiles").select("*").eq("id", id).single().then(ok);

export const updateProfile = (id, patch) =>
  supabase.from("profiles").update(patch).eq("id", id).select().single().then(ok);

export async function uploadAvatar(userId, file) {
  const path = `${userId}/avatar-${Date.now()}.${file.name.split(".").pop()}`;
  ok(await supabase.storage.from("avatars").upload(path, file, { upsert: true }));
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  await updateProfile(userId, { avatar_url: data.publicUrl });
  return data.publicUrl;
}

export const listProfiles = () =>
  supabase.from("profiles").select("*").order("pseudo").then(ok);

// ── SORTIES ─────────────────────────────────────────────────────
const ACT_SELECT = `*, creator:profiles!creator_id(*),
  members:activity_members(status, user:profiles(*))`;

const shapeActivity = (a) => ({
  ...a,
  maxPeople: a.max_people,
  accepted: a.members.filter(m => m.status === "accepted").map(m => m.user),
  pending:  a.members.filter(m => m.status === "pending").map(m => m.user),
});

export const listActivities = () =>
  supabase.from("activities").select(ACT_SELECT).order("created_at", { ascending: false })
    .then(ok).then(rows => rows.map(shapeActivity));

export const createActivity = (userId, f) =>
  supabase.from("activities").insert({
    creator_id: userId, title: f.title, category: f.category, date: f.date, time: f.time,
    location: f.location, lat: f.lat ?? null, lng: f.lng ?? null,
    max_people: f.maxPeople, description: f.description,
  }).select().single().then(ok); // le trigger ajoute le créateur + notifie ses amis

export const requestJoin = (activityId, userId) =>
  supabase.from("activity_members").insert({ activity_id: activityId, user_id: userId }).then(ok);

export const acceptMember = (activityId, userId) =>
  supabase.from("activity_members").update({ status: "accepted" })
    .eq("activity_id", activityId).eq("user_id", userId).then(ok);

export const rejectMember = (activityId, userId) =>
  supabase.from("activity_members").delete()
    .eq("activity_id", activityId).eq("user_id", userId).then(ok);

// ── VOCAUX (stockage privé + URLs signées) ──────────────────────
async function uploadVoice(userId, blob) {
  const path = `${userId}/${Date.now()}.webm`;
  ok(await supabase.storage.from("voices").upload(path, blob, { contentType: "audio/webm" }));
  return path;
}
export const voiceUrl = async (path) =>
  ok(await supabase.storage.from("voices").createSignedUrl(path, 3600)).signedUrl;

// ── CHAT DE GROUPE ──────────────────────────────────────────────
export const listActivityMessages = (activityId) =>
  supabase.from("activity_messages").select("*, sender:profiles(*)")
    .eq("activity_id", activityId).order("created_at").then(ok);

export const sendActivityMessage = (activityId, userId, text) =>
  supabase.from("activity_messages").insert({ activity_id: activityId, sender_id: userId, text }).then(ok);

export async function sendActivityVoice(activityId, userId, blob, duration) {
  const audio_path = await uploadVoice(userId, blob);
  return supabase.from("activity_messages")
    .insert({ activity_id: activityId, sender_id: userId, type: "voice", audio_path, duration }).then(ok);
}

export const subscribeActivityMessages = (activityId, cb) =>
  supabase.channel(`act-${activityId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_messages", filter: `activity_id=eq.${activityId}` },
      p => cb(p.new))
    .subscribe();

// ── AMIS ────────────────────────────────────────────────────────
export const sendFriendRequest = (me, other) =>
  supabase.from("friendships").insert({ requester_id: me, addressee_id: other }).then(ok);

export const acceptFriend = (friendshipId) =>
  supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId).then(ok);

export const listFriendships = () =>
  supabase.from("friendships")
    .select("*, requester:profiles!requester_id(*), addressee:profiles!addressee_id(*)").then(ok);

// ── MESSAGES PRIVÉS ─────────────────────────────────────────────
export const listDMs = (me, other) =>
  supabase.from("direct_messages").select("*")
    .or(`and(sender_id.eq.${me},receiver_id.eq.${other}),and(sender_id.eq.${other},receiver_id.eq.${me})`)
    .order("created_at").then(ok);

export const listRecentDMs = () =>
  supabase.from("direct_messages").select("*").order("created_at", { ascending: false }).limit(300).then(ok);

export const sendDM = (me, other, text) =>
  supabase.from("direct_messages").insert({ sender_id: me, receiver_id: other, text }).then(ok);

export async function sendDMVoice(me, other, blob, duration) {
  const audio_path = await uploadVoice(me, blob);
  return supabase.from("direct_messages")
    .insert({ sender_id: me, receiver_id: other, type: "voice", audio_path, duration }).then(ok);
}

export const subscribeDMs = (me, cb) =>
  supabase.channel(`dm-${me}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages", filter: `receiver_id=eq.${me}` },
      p => cb(p.new))
    .subscribe();

// ── NOTIFICATIONS ───────────────────────────────────────────────
export const listNotifications = () =>
  supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50).then(ok);

export const markAllRead = (userId) =>
  supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false).then(ok);

export const subscribeNotifications = (userId, cb) =>
  supabase.channel(`notif-${userId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      p => cb(p.new))
    .subscribe();
