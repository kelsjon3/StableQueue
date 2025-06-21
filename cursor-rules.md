# Cursor Rules for StableQueue

## 📦 Runtime Environment

- This project runs **inside a Docker container on an Unraid server**.
- The container includes the **application code and an SQLite3 database**.
- Do not assume local execution — runtime and testing always happen **inside the container**.
- Container IP: `192.168.73.124`
- SSH access: `ssh root@192.168.73.124` (no password; SSH key is configured)

## 📂 Volume Mounts (Container ↔ Host)

- `/usr/src/app/data` ⟷ `/mnt/user/appdata/stablequeue/data`
- `/app/outputs`      ⟷ `/mnt/user/Stable_Diffusion_Data/outputs`
- `/app/models`       ⟷ `/mnt/user/Stable_Diffusion_Data/models`

> The database path inside the container is:  
> `/usr/src/app/data/stablequeue.db`

## ⚙️ Environment Detection

- The environment variable `DOCKER_ENV=true` is set inside the container.
- Code should behave differently depending on whether this is set (e.g., path selection).

## 🚀 Deployment

- All changes must be deployed using:  
  `deploy-stablequeue-to-unraid.sh`
- **No manual deployment** is allowed — this is the only valid method.

## 📘 Database Schema

- Full schema reference is located in:  
  `docs/DATABASE_SCHEMA.md`

---

**Summary**:  
Do not test, access the DB, or suggest running anything locally. Assume all operations must occur inside the Docker container on Unraid.

