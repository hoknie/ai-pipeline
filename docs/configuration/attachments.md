# Task attachments

## `attachments`

The shared `settings.yaml` controls where **new** task attachments are stored. Without this section, attachments use the daemon's local folder. A project `aip/settings.yaml` cannot set `attachments` (`swarm.attachments` is a validation error).

```yaml
attachments:
  storage: s3                   # local (default) | s3
  s3:
    bucket: my-task-files       # required when storage is s3
    region: us-east-1           # default
    endpoint: http://127.0.0.1:9000  # optional; omit for AWS S3
    prefix: aip/attachments/    # default; no leading /
    path_style: true            # false by default; true for MinIO
```

| Field | Default | Meaning |
|---|---|---|
| `storage` | `local` | Storage for new attachments: `local` or `s3` |
| `s3.bucket` | none | Bucket name; required for `storage: s3` |
| `s3.region` | `us-east-1` | Region used to sign S3 requests |
| `s3.endpoint` | none | Optional `http://` or `https://` URL for an S3-compatible service |
| `s3.prefix` | `aip/attachments/` | Prefix prepended to each attachment ID; must not start with `/` |
| `s3.path_style` | `false` | Put the bucket in the URL path instead of the host name |

For MinIO on the same machine, set `endpoint: http://127.0.0.1:9000` and `path_style: true` as above; objects are written at `<endpoint>/<bucket>/<prefix><attachment-id>`.

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the **daemon's environment** before starting it.
`AWS_SESSION_TOKEN` is optional for temporary credentials. Never put access keys in `settings.yaml`; unknown S3 keys are rejected.
The daemon must restart to pick up changed environment credentials.
Changes to `storage` and other configuration fields are reread for each new attachment without restarting.
Existing attachments are not moved: old local files remain readable when you switch to S3, and old S3 objects remain readable when you switch back, provided the credentials and S3 service are available.
