// Raw bytes. Base64 inflates by ~4/3 and the whole item travels as one JSON
// body, which has to stay under Vercel's 4.5 MB request cap, so 3 MB of
// file is the safe ceiling (the old 4 MB limit produced ~5.4 MB bodies and
// failed for files between ~3.3 and 4 MB).
export const MAX_BROADCAST_BYTES = 3 * 1024 * 1024;
