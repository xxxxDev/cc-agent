# Rotating the push keys

CC Agent makes its Web Push keys once, at the first start, in `push-keys.json` in the data folder (`.local/` by default). There are three: the VAPID key pair that browsers know the server by, the key the stored subscriptions are encrypted with, and the key their fingerprints are taken with. Rotate them if that file may have been seen by someone else.

The service accepts a current and a previous key of each kind, so notifications keep working while devices move over. `server/scripts/rotate-push-keys.js` then moves the stored subscriptions onto the current keys.

## Steps

1. **Stop CC Agent**, and keep a copy of the data folder.

2. **Make new keys.** Run these from the project folder:

   ```bash
   node -e "console.log(require('web-push').generateVAPIDKeys())"
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   The first gives the VAPID key pair, the second the encryption key, the third the fingerprint key.

3. **Edit `push-keys.json`.** Move each old value to the `_PREVIOUS` name with the old id, and put the new value under the usual name with a new id. A file that has never been rotated uses the id `k0`.

   ```json
   {
     "VAPID_SUBJECT": "https://cc-agent.example.com",
     "VAPID_PUBLIC_KEY": "<new public key>",
     "VAPID_PRIVATE_KEY": "<new private key>",
     "VAPID_KEY_ID": "k1",
     "VAPID_PUBLIC_KEY_PREVIOUS": "<old public key>",
     "VAPID_PRIVATE_KEY_PREVIOUS": "<old private key>",
     "VAPID_KEY_ID_PREVIOUS": "k0",
     "PUSH_SUBSCRIPTION_ENCRYPTION_KEY": "<new encryption key>",
     "PUSH_SUBSCRIPTION_ENCRYPTION_KEY_ID": "k1",
     "PUSH_SUBSCRIPTION_ENCRYPTION_KEY_PREVIOUS": "<old encryption key>",
     "PUSH_SUBSCRIPTION_ENCRYPTION_KEY_PREVIOUS_ID": "k0",
     "PUSH_SUBSCRIPTION_HMAC_KEY": "<new fingerprint key>",
     "PUSH_SUBSCRIPTION_HMAC_KEY_ID": "k1",
     "PUSH_SUBSCRIPTION_HMAC_KEY_PREVIOUS": "<old fingerprint key>",
     "PUSH_SUBSCRIPTION_HMAC_KEY_PREVIOUS_ID": "k0"
   }
   ```

4. **Check what would change.** `--db-dir` is the `auth` folder inside the data folder. A dry run only reads: it parses `push-subscriptions.db`, `push-deliveries.db` and `sessions.db` with NeDB's own reader and never opens them for writing, so no file is created, rewritten or compacted. It sees the same documents the service and the apply would load, and `unreadableLines` counts, for each file, the lines NeDB would drop as broken; a file NeDB would refuse to load is refused here too. It prints a report and exits with 1 while there is something to change.

   A dry run or an apply refuses a `--db-dir` that does not exist or lacks one of those three files, so a mistyped path cannot pass for an install with nothing to move; a restore needs the folder to exist. Every run also refuses while CC Agent is running on that data folder: `scripts/start.mjs` keeps `server.lock` beside `auth`, naming its process, and a lock whose process is still alive stops the script. An apply or a restore then holds `server.lock` itself until it ends, so `scripts/start.mjs` refuses to start meanwhile. A service started some other way leaves no such lock, so stopping it stays your job.

   A file ending in `.db~` beside one of the stores is what NeDB leaves when it stops in the middle of rewriting a store. A dry run and an apply refuse while one is there: NeDB ignores it as long as the `.db` file is present, so remove it, then run again. A restore removes it by itself once the store is back.

   ```bash
   node server/scripts/rotate-push-keys.js --dry-run --db-dir .local/auth --keys .local/push-keys.json
   ```

5. **Apply.** `--backup-dir` must be a new or empty folder: both push stores are copied there first. `--ack-quiesced` says the service is stopped.

   ```bash
   node server/scripts/rotate-push-keys.js --apply --db-dir .local/auth --keys .local/push-keys.json --backup-dir ~/push-backup --ack-quiesced
   ```

   To put the backup back, stop CC Agent and run it with `--restore --db-dir .local/auth --backup-dir ~/push-backup --ack-quiesced`. This restores the two push stores only, not `push-keys.json`: the restored rows are still under the old keys, so keep the `_PREVIOUS` entries in `push-keys.json`, or put back the old `push-keys.json` from the copy made in step 1, before starting CC Agent again.

6. **Start CC Agent.** Each device moves to the new VAPID key by itself the next time it opens the app.

7. **Remove the previous keys** once no device in use is left on the previous VAPID key. Stop CC Agent and run the dry run from step 4 again. When it shows nothing to change and `activeSubscriptionsOnPreviousVapidKey` is 0, delete the `_PREVIOUS` entries from `push-keys.json` and start CC Agent. If devices are still on the previous key, start CC Agent with the file unchanged and check again later. `subscriptionsOnPreviousVapidKey` also counts the rows a device left behind when it subscribed again; nothing is sent to those, so they do not hold the previous keys back. A device that has not opened the app by the time the keys go gets no notifications until it next does.
