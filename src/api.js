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
  supabase.auth.onAuthStateChange((event, session) => cb(session, event)).data.subscription;

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
    max_people: f.maxPeople, description: f.description, photo_url: f.photo_url ?? null,
  }).select().single().then(ok); // le trigger ajoute le créateur + notifie ses amis

export const deleteActivity = (id) =>
  supabase.from("activities").delete().eq("id", id).then(ok);

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
  const type = (blob.type || "audio/webm").split(";")[0];
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const path = `${userId}/${Date.now()}.${ext}`;
  ok(await supabase.storage.from("voices").upload(path, blob, { contentType: type }));
  return path;
}
export const voiceUrl = async (path) =>
  ok(await supabase.storage.from("voices").createSignedUrl(path, 3600)).signedUrl;

// ── CHAT DE GROUPE ──────────────────────────────────────────────
export const listActivityMessages = (activityId) =>
  supabase.from("activity_messages").select("*, sender:profiles(*)")
    .eq("activity_id", activityId).order("created_at").then(ok);

export const sendActivityMessage = (activityId, userId, text, replyTo = null) =>
  supabase.from("activity_messages").insert({ activity_id: activityId, sender_id: userId, text, reply_to: replyTo }).then(ok);

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

export const sendDM = (me, other, text, replyTo = null) =>
  supabase.from("direct_messages").insert({ sender_id: me, receiver_id: other, text, reply_to: replyTo }).then(ok);

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

export const markNotifRead = (id) =>
  supabase.from("notifications").update({ read: true }).eq("id", id).then(ok);

export const markMessageNotifsRead = (userId, fromId) =>
  supabase.from("notifications").update({ read: true })
    .eq("user_id", userId).eq("kind", "message").eq("ref_id", fromId).eq("read", false).then(ok);

export const markAllRead = (userId) =>
  supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false).then(ok);

export const subscribeNotifications = (userId, cb) =>
  supabase.channel(`notif-${userId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      p => cb(p.new))
    .subscribe();

// ── LOCALISATION ────────────────────────────────────────────────
export const saveMyLocation = (userId, lat, lng, city) =>
  supabase.from("user_locations").upsert({ user_id: userId, lat, lng, city, updated_at: new Date().toISOString() }).then(ok);

export const removeMyLocation = (userId) =>
  supabase.from("user_locations").delete().eq("user_id", userId).then(ok);

export const nearbyUsers = (radiusKm) =>
  supabase.rpc("nearby_users", { radius_km: radiusKm }).then(ok);

// ── PHOTOS / VIDÉOS / GIFS (messages privés) ────────────────────
export async function sendDMMedia(me, other, kind, file) {
  const ext = (file.name?.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase();
  const media_path = `${me}/${Date.now()}.${ext}`;
  ok(await supabase.storage.from("media").upload(media_path, file, { contentType: file.type || undefined }));
  return supabase.from("direct_messages").insert({ sender_id: me, receiver_id: other, type: kind, media_path }).then(ok);
}

export const sendDMGif = (me, other, url) =>
  supabase.from("direct_messages").insert({ sender_id: me, receiver_id: other, type: "gif", media_url: url }).then(ok);

export const mediaUrl = async (path) =>
  ok(await supabase.storage.from("media").createSignedUrl(path, 3600)).signedUrl;

// ── MOT DE PASSE ────────────────────────────────────────────────
// Adresse publique du site (dans l'application mobile, window.location.origin n'est pas une vraie adresse web)
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || "https://grouz.fr";

export const requestPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: PUBLIC_URL }).then(ok);

export const updatePassword = (password) =>
  supabase.auth.updateUser({ password }).then(ok);

// ── BLOCAGE / SIGNALEMENT ───────────────────────────────────────
export const listBlocks = () =>
  supabase.from("user_blocks").select("blocked_id, created_at").then(ok);

export const blockUser = (me, other) =>
  supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: other }).then(ok);

export const unblockUser = (me, other) =>
  supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", other).then(ok);

export const reportUser = (me, other, reason, details = "", context = "profile", contextId = null) =>
  supabase.from("reports").insert({ reporter_id: me, target_user_id: other, reason, details, context, context_id: contextId }).then(ok);

// ── SUPPRESSION DU COMPTE ───────────────────────────────────────
export async function deleteMyAccount(userId) {
  for (const bucket of ["avatars", "voices", "media", "activity-photos", "posts", "stories"]) {   // d'abord les fichiers
    try {
      const { data } = await supabase.storage.from(bucket).list(userId, { limit: 1000 });
      if (data?.length) await supabase.storage.from(bucket).remove(data.map(f => `${userId}/${f.name}`));
    } catch {}
  }
  ok(await supabase.rpc("delete_my_account"));            // puis le compte et toutes les données
  try { await supabase.auth.signOut(); } catch {}
}

// ── PREMIUM ─────────────────────────────────────────────────────
export const myActivitiesToday = () => supabase.rpc("my_activities_today").then(ok);

export async function uploadActivityPhoto(userId, file) {
  const path = `${userId}/${Date.now()}.${(file.name?.split(".").pop() || "jpg").toLowerCase()}`;
  ok(await supabase.storage.from("activity-photos").upload(path, file, { contentType: file.type || undefined }));
  return supabase.storage.from("activity-photos").getPublicUrl(path).data.publicUrl;
}

export const recordProfileView = (profileId) =>
  supabase.rpc("record_profile_view", { p: profileId }).then(({ error }) => { if (error) console.warn(error); });

export const myProfileViewers = () => supabase.rpc("my_profile_viewers").then(ok);

// ── SOUVENIRS (photos / vidéos) ─────────────────────────────────
const fileExt = (file, kind) => (file.name?.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
const kindOf = (file) => (file.type || "").startsWith("video") ? "video" : "image";
const pubUrl = (bucket, path) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

export const listPosts = () =>
  supabase.from("posts").select("*, author:profiles!user_id(*), activity:activities!activity_id(id,title), likes:post_likes(user_id), comments:post_comments(id)")
    .order("created_at", { ascending: false }).limit(300)
    .then(ok).then(rows => rows.map(p => ({ ...p, url: pubUrl("posts", p.media_path) })));

export async function createPost(userId, { file, category, caption, activityId }) {
  const media_type = kindOf(file);
  const media_path = `${userId}/${Date.now()}.${fileExt(file, media_type)}`;
  ok(await supabase.storage.from("posts").upload(media_path, file, { contentType: file.type || undefined }));
  return supabase.from("posts").insert({ user_id: userId, category, caption: caption || null, activity_id: activityId || null, media_path, media_type }).then(ok);
}

export async function deletePost(post) {
  ok(await supabase.from("posts").delete().eq("id", post.id));
  try { await supabase.storage.from("posts").remove([post.media_path]); } catch {}
}

// ── STORIES (24 h) ──────────────────────────────────────────────
export const listStories = () =>
  supabase.from("stories").select("*, author:profiles!user_id(*), likes:story_likes(user_id), views:story_views(viewer_id)")
    .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .then(ok).then(rows => rows.map(s => ({ ...s, url: pubUrl("stories", s.media_path), music_url: s.music_path ? pubUrl("stories", s.music_path) : null })));

export async function createStory(userId, file, opts = {}) {
  const media_type = kindOf(file);
  const media_path = `${userId}/${Date.now()}.${fileExt(file, media_type)}`;
  ok(await supabase.storage.from("stories").upload(media_path, file, { contentType: file.type || undefined }));
  let music_path = null;
  if (opts.musicFile) {
    music_path = `${userId}/${Date.now()}-music.${(opts.musicFile.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5)}`;
    ok(await supabase.storage.from("stories").upload(music_path, opts.musicFile, { contentType: opts.musicFile.type || undefined }));
  }
  // ménage : on supprime mes anciennes stories expirées (lignes + fichiers)
  try {
    const old = ok(await supabase.from("stories").select("id, media_path, music_path").eq("user_id", userId)
      .lt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()));
    if (old?.length) {
      await supabase.from("stories").delete().in("id", old.map(o => o.id));
      await supabase.storage.from("stories").remove(old.flatMap(o => [o.media_path, o.music_path].filter(Boolean)));
    }
  } catch {}
  return supabase.from("stories").insert({ user_id: userId, media_path, media_type, overlays: opts.overlays?.length ? opts.overlays : null, music_path, music_title: opts.musicTitle || null }).then(ok);
}

export async function deleteStory(story) {
  ok(await supabase.from("stories").delete().eq("id", story.id));
  try { await supabase.storage.from("stories").remove([story.media_path, story.music_path].filter(Boolean)); } catch {}
}

// ── LIKES / COMMENTAIRES ────────────────────────────────────────
export const likePost = (postId, userId) => supabase.from("post_likes").insert({ post_id: postId, user_id: userId }).then(ok);
export const unlikePost = (postId, userId) => supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId).then(ok);
export const listComments = (postId) =>
  supabase.from("post_comments").select("*, author:profiles!user_id(*), likes:comment_likes(user_id)").eq("post_id", postId).order("created_at").then(ok);
export const addComment = (postId, userId, text, parentId = null) =>
  supabase.from("post_comments").insert({ post_id: postId, user_id: userId, text, parent_id: parentId }).then(ok);
export const deleteComment = (id) => supabase.from("post_comments").delete().eq("id", id).then(ok);
export const likeStory = (storyId, userId) => supabase.from("story_likes").insert({ story_id: storyId, user_id: userId }).then(ok);
export const unlikeStory = (storyId, userId) => supabase.from("story_likes").delete().eq("story_id", storyId).eq("user_id", userId).then(ok);
export const likeComment = (commentId, userId) => supabase.from("comment_likes").insert({ comment_id: commentId, user_id: userId }).then(ok);
export const unlikeComment = (commentId, userId) => supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", userId).then(ok);

// ── QUI A VU MA STORY ───────────────────────────────────────────
export const recordStoryView = (storyId, userId) =>
  supabase.from("story_views").upsert({ story_id: storyId, viewer_id: userId }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true }).then(({ error }) => { if (error) console.warn(error); });
export const listStoryViews = (storyId) =>
  supabase.from("story_views").select("viewer_id, viewed_at, viewer:profiles!viewer_id(*)").eq("story_id", storyId).order("viewed_at", { ascending: false }).then(ok);

// ── GROUPES DE DISCUSSION ───────────────────────────────────────
export const listGroups = () =>
  supabase.from("group_chats").select("*, members:group_members(user_id, role, user:profiles(*))").order("created_at", { ascending: false }).then(ok);

export async function setGroupAvatar(me, groupId, file) {
  const path = `${me}/group-${groupId}-${Date.now()}.jpg`;
  ok(await supabase.storage.from("avatars").upload(path, file, { contentType: file.type || "image/jpeg" }));
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  ok(await supabase.from("group_chats").update({ avatar_url: data.publicUrl }).eq("id", groupId));
  return data.publicUrl;
}
export async function createGroup(me, name, memberIds, photo) {
  const g = ok(await supabase.from("group_chats").insert({ name, created_by: me }).select().single());
  if (memberIds.length) ok(await supabase.from("group_members").insert(memberIds.map(id => ({ group_id: g.id, user_id: id }))));
  if (photo) { try { await setGroupAvatar(me, g.id, photo); } catch (e) { console.warn("photo de groupe", e); } }
  return g;
}
export const renameGroup = (id, name) => supabase.from("group_chats").update({ name }).eq("id", id).then(ok);
export const addGroupMembers = (groupId, ids) => supabase.from("group_members").insert(ids.map(id => ({ group_id: groupId, user_id: id }))).then(ok);
export const removeGroupMember = (groupId, userId) => supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId).then(ok);
export const deleteGroup = (id) => supabase.from("group_chats").delete().eq("id", id).then(ok);

export const listGroupMessages = (groupId) =>
  supabase.from("group_messages").select("*, sender:profiles!sender_id(*)").eq("group_id", groupId).order("created_at").limit(500).then(ok);
export const listRecentGroupMessages = () =>
  supabase.from("group_messages").select("*").order("created_at", { ascending: false }).limit(300).then(ok);
export const sendGroupMessage = (groupId, me, text, replyTo = null) =>
  supabase.from("group_messages").insert({ group_id: groupId, sender_id: me, text, reply_to: replyTo }).then(ok);
export async function sendGroupVoice(groupId, me, blob, duration) {
  const audio_path = await uploadVoice(me, blob);
  return supabase.from("group_messages").insert({ group_id: groupId, sender_id: me, type: "voice", audio_path, duration }).then(ok);
}
export async function sendGroupMedia(groupId, me, kind, file) {
  const ext = (file.name?.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase();
  const media_path = `${me}/${Date.now()}.${ext}`;
  ok(await supabase.storage.from("media").upload(media_path, file, { contentType: file.type || undefined }));
  return supabase.from("group_messages").insert({ group_id: groupId, sender_id: me, type: kind, media_path }).then(ok);
}
export const sendGroupGif = (groupId, me, url) =>
  supabase.from("group_messages").insert({ group_id: groupId, sender_id: me, type: "gif", media_url: url }).then(ok);
export const subscribeGroupMessages = (groupId, cb) =>
  supabase.channel(`grp-${groupId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` }, p => cb(p.new))
    .subscribe();
export const markGroupNotifsRead = (userId, groupId) =>
  supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("kind", "group_message").eq("ref_id", groupId).eq("read", false).then(ok);
export const transferGroupAdmin = (groupId, newAdmin) => supabase.rpc("transfer_group_admin", { g: groupId, new_admin: newAdmin }).then(ok);

// ── PHOTOS / VIDÉOS / GIF dans les discussions de sortie ────────
export async function sendActivityMedia(activityId, userId, kind, file) {
  const ext = (file.name?.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase();
  const media_path = `${userId}/${Date.now()}.${ext}`;
  ok(await supabase.storage.from("media").upload(media_path, file, { contentType: file.type || undefined }));
  return supabase.from("activity_messages").insert({ activity_id: activityId, sender_id: userId, type: kind, media_path }).then(ok);
}
export const sendActivityGif = (activityId, userId, url) =>
  supabase.from("activity_messages").insert({ activity_id: activityId, sender_id: userId, type: "gif", media_url: url }).then(ok);

// ── RÉACTIONS / ANNULATION D'ENVOI ──────────────────────────────
export const listReactions = (scope, ids) =>
  ids.length ? supabase.from("message_reactions").select("message_id, user_id, emoji").eq("scope", scope).in("message_id", ids).then(ok) : Promise.resolve([]);
export const setReaction = (scope, messageId, userId, emoji) =>
  supabase.from("message_reactions").upsert({ scope, message_id: messageId, user_id: userId, emoji }, { onConflict: "scope,message_id,user_id" }).then(ok);
export const removeReaction = (scope, messageId, userId) =>
  supabase.from("message_reactions").delete().eq("scope", scope).eq("message_id", messageId).eq("user_id", userId).then(ok);

const TABLES = { dm: "direct_messages", group: "group_messages", activity: "activity_messages" };
export async function unsendMessage(scope, msg) {
  ok(await supabase.from(TABLES[scope]).delete().eq("id", msg.id));
  // on retire aussi le fichier (vocal, photo, vidéo) s'il m'appartient
  try {
    if (msg.audio_path) await supabase.storage.from("voices").remove([msg.audio_path]);
    if (msg.media_path) await supabase.storage.from("media").remove([msg.media_path]);
  } catch {}
}

// ── Liste d'attente + dispo ce soir ──
export const myWaitlistState = (activityId, userId) => supabase.from("activity_waitlist").select("user_id").eq("activity_id", activityId).eq("user_id", userId).then(ok).then(r => r.length > 0);
export const joinWaitlist = (activityId, userId) => supabase.from("activity_waitlist").insert({ activity_id: activityId, user_id: userId }).then(ok);
export const leaveWaitlist = (activityId, userId) => supabase.from("activity_waitlist").delete().eq("activity_id", activityId).eq("user_id", userId).then(ok);
export const setAvailableUntil = (userId, iso) => supabase.from("profiles").update({ available_until: iso }).eq("id", userId).select().single().then(ok);

// ── Épinglage + sondages ──
export const pinMessage = (scope, id, pin) => supabase.rpc("pin_message", { sc: scope, mid: id, pin }).then(ok);
export async function createPoll(scope, convId, userId, question, options) {
  const poll = ok(await supabase.from("polls").insert({ scope, conv_id: convId, creator_id: userId, question, options }).select().single());
  const row = scope === "group" ? { group_id: convId, sender_id: userId, text: "📊 " + question, poll_id: poll.id }
                                : { activity_id: convId, sender_id: userId, text: "📊 " + question, poll_id: poll.id };
  ok(await supabase.from(scope === "group" ? "group_messages" : "activity_messages").insert(row));
  return poll;
}
export const getPoll = async (id) => {
  const poll = ok(await supabase.from("polls").select("*").eq("id", id).single());
  const votes = ok(await supabase.from("poll_votes").select("user_id, option_idx").eq("poll_id", id));
  return { ...poll, votes };
};
export const votePoll = (pollId, userId, idx) => supabase.from("poll_votes").upsert({ poll_id: pollId, user_id: userId, option_idx: idx }, { onConflict: "poll_id,user_id" }).then(ok);
export const unvotePoll = (pollId, userId) => supabase.from("poll_votes").delete().eq("poll_id", pollId).eq("user_id", userId).then(ok);
