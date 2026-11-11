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

4. **Check what would change.** `--db-dir` is the `auth` folder inside the data folder. A dry run changes nothing. It prints a report and exits with 1 while there is something to change.

   ```bash
   node server/scripts/rotate-push-keys.js --dry-run --db-dir .local/auth --keys .local/push-keys.json
   ```

5. **Apply.** `--backup-dir` must be a new or empty folder: both push stores are copied there first. `--ack-quiesced` says the service is stopped.

   ```bash
   node server/scripts/rotate-push-keys.js --apply --db-dir .local/auth --keys .local/push-keys.json --backup-dir ~/push-backup --ack-quiesced
   ```

   To put the backup back, run it with `--restore --db-dir .local/auth --backup-dir ~/push-backup --ack-quiesced`.

6. **Start CC Agent.** Each device moves to the new VAPID key by itself the next time it opens the app.

7. **Remove the previous keys** once a dry run shows nothing to change and no subscription on the previous VAPID key (`subscriptionsOnPreviousVapidKey` is 0). Delete the `_PREVIOUS` entries from `push-keys.json` and restart CC Agent. A device that has not opened the app by then gets no notifications until it next does.
