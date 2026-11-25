import { generateCode } from '../utils.js';

const ALREADY_EXISTS = 6; // gRPC status code used by Firestore

/**
 * Firestore-backed persistence (Admin SDK). The same interface is implemented
 * in-memory in test/ so the API can be tested without Firebase.
 *
 * meetings/{code}
 *   title, hostUid, hostName, status ('active'|'ended'), participants[uid], createdAt, endedAt,
 *   waitingRoom, hasPassword, scheduledFor,
 *   summary, summaryStatus ('none'|'pending'|'ready'|'failed'|'empty')
 *   /messages/{id}     chat messages          (written by the sender's browser)
 *   /transcripts/{id}  final speech segments  (written by the speaker's browser)
 * meetingSecrets/{code}  { passwordHash } - no client rule matches, so only the Admin SDK can read it
 */
export function createFirestoreStore(db, FieldValue) {
  const meetings = db.collection('meetings');

  return {
    async createMeeting({ title, hostUid, hostName, waitingRoom = false, passwordHash = null, scheduledFor = null }) {
      for (let i = 0; i < 6; i += 1) {
        const code = generateCode();
        const doc = {
          code, title, hostUid, hostName,
          status: 'active',
          waitingRoom: !!waitingRoom,
          hasPassword: !!passwordHash,
          scheduledFor,
          participants: [hostUid],
          createdAt: Date.now(),
          summary: null,
          summaryStatus: 'none',
        };
        try {
          await meetings.doc(code).create(doc);
          if (passwordHash) await db.collection('meetingSecrets').doc(code).set({ passwordHash });
          return doc;
        } catch (e) {
          if (e.code !== ALREADY_EXISTS) throw e;
        }
      }
      throw new Error('Could not allocate a unique meeting code');
    },

    async getMeeting(code) {
      const snap = await meetings.doc(code).get();
      return snap.exists ? snap.data() : null;
    },

    async getSecret(code) {
      const snap = await db.collection('meetingSecrets').doc(code).get();
      return snap.exists ? snap.data() : null;
    },

    async reopenMeeting(code) {
      await meetings.doc(code).update({ status: 'active', reopenedAt: Date.now(), endedAt: FieldValue.delete() });
    },

    async addParticipant(code, uid) {
      await meetings.doc(code).update({ participants: FieldValue.arrayUnion(uid) });
    },

    async endMeeting(code) {
      await meetings.doc(code).update({ status: 'ended', endedAt: Date.now(), summaryStatus: 'pending' });
    },

    async saveSummary(code, summary, status = 'ready') {
      await meetings.doc(code).update({ summary, summaryStatus: status, summaryAt: Date.now() });
    },

    /** Used when the live in-memory buffer is gone (e.g. server restarted). */
    async getContext(code, limit = 400) {
      const read = async (sub, type) => {
        const snap = await meetings.doc(code).collection(sub).orderBy('ts', 'desc').limit(limit).get();
        return snap.docs.map((d) => {
          const m = d.data();
          return { ts: m.ts, who: m.name, type, text: m.text };
        });
      };
      const [chat, speech] = await Promise.all([read('messages', 'chat'), read('transcripts', 'speech')]);
      return [...chat, ...speech].sort((a, b) => a.ts - b.ts);
    },
  };
}
