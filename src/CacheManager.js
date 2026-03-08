/**
 * CacheManager.js
 * マルチレベルキャッシング
 * - Layer 1: インメモリ (5-10分, 50MB)
 * - Layer 2: ディスク (24時間, 500MB)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CacheManager {
  constructor(cacheDir = '../data/cache') {
    this.cacheDir = path.resolve(__dirname, cacheDir);
    this.memoryCache = new Map();
    this.maxMemorySize = 50 * 1024 * 1024; // 50MB
    this.currentMemorySize = 0;
    this.maxDiskSize = 500 * 1024 * 1024; // 500MB

    // ディレクトリ確保
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * キャッシュキーを生成
   */
  generateKey(query, context = {}) {
    const contextStr = JSON.stringify(context);
    return crypto.createHash('md5').update(query + contextStr).digest('hex');
  }

  /**
   * インメモリキャッシュから取得
   */
  getMemoryCache(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    // TTL チェック（5分）
    const age = (Date.now() - entry.timestamp) / 1000 / 60;
    if (age > 5) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * ディスクキャッシュから取得
   */
  getDiskCache(key) {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`);
      if (!fs.existsSync(filePath)) return null;

      const stat = fs.statSync(filePath);
      // TTL チェック（24時間）
      const ageHours = (Date.now() - stat.mtime) / (1000 * 60 * 60);
      if (ageHours > 24) {
        fs.unlinkSync(filePath);
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * キャッシュから取得（メモリ → ディスク）
   */
  get(key) {
    // Layer 1: インメモリ
    const memEntry = this.getMemoryCache(key);
    if (memEntry) {
      console.log(`[Cache] ✅ Memory hit: ${key.substring(0, 8)}...`);
      return memEntry;
    }

    // Layer 2: ディスク
    const diskEntry = this.getDiskCache(key);
    if (diskEntry) {
      console.log(`[Cache] ✅ Disk hit: ${key.substring(0, 8)}...`);
      // ディスク→メモリに昇格
      this.setMemoryCache(key, diskEntry);
      return diskEntry;
    }

    return null;
  }

  /**
   * インメモリキャッシュに保存
   */
  setMemoryCache(key, data) {
    const size = JSON.stringify(data).length;

    // メモリサイズチェック
    if (this.currentMemorySize + size > this.maxMemorySize) {
      // LRU削除：最も古いエントリを削除
      const oldestKey = Array.from(this.memoryCache.keys()).shift();
      if (oldestKey) {
        const removedSize = JSON.stringify(this.memoryCache.get(oldestKey).data).length;
        this.memoryCache.delete(oldestKey);
        this.currentMemorySize -= removedSize;
      }
    }

    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
    });
    this.currentMemorySize += size;
  }

  /**
   * ディスクキャッシュに保存
   */
  setDiskCache(key, data) {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`);
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`[Cache] Disk write error: ${error.message}`);
    }
  }

  /**
   * キャッシュに保存（メモリ + ディスク）
   */
  set(key, data) {
    console.log(`[Cache] 💾 Caching: ${key.substring(0, 8)}...`);
    this.setMemoryCache(key, data);
    this.setDiskCache(key, data);
  }

  /**
   * キャッシュをクリア
   */
  clear(key = null) {
    if (key) {
      // 特定キーをクリア
      this.memoryCache.delete(key);
      try {
        const filePath = path.join(this.cacheDir, `${key}.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`[Cache] Clear error: ${error.message}`);
      }
    } else {
      // 全キャッシュクリア
      this.memoryCache.clear();
      try {
        const files = fs.readdirSync(this.cacheDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(this.cacheDir, file));
        });
      } catch (error) {
        console.error(`[Cache] Full clear error: ${error.message}`);
      }
    }
  }

  /**
   * キャッシュ統計
   */
  getStats() {
    return {
      memoryEntries: this.memoryCache.size,
      memorySize: this.currentMemorySize,
      diskEntries: fs.readdirSync(this.cacheDir).length,
    };
  }
}

module.exports = CacheManager;
