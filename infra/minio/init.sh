#!/bin/sh
set -eu
for attempt in $(seq 1 60); do
  if mc alias set local http://minio:9000 local-minio-user local-minio-password-change-me >/dev/null 2>&1; then break; fi
  sleep 2
done
for bucket in cc-quarantine cc-originals cc-previews; do
  mc mb --ignore-existing local/$bucket
  mc version enable local/$bucket
  mc anonymous set none local/$bucket
done
# The only public bucket contains generated previews, never source uploads.
mc anonymous set download local/cc-previews
mc cors set local/cc-quarantine /setup/cors.xml
mc ilm rule add --id abort-incomplete-uploads --abort-incomplete-multipart-upload-days 2 local/cc-quarantine || {
  echo 'Lifecycle rule already exists or needs manual configuration; inspect MinIO before launch.' >&2
}
echo 'Development object storage initialized.'
