// event-bus.js — 中央发布/订阅事件系统。解耦所有模块。

/**
 * 应用级事件总线。模块间通信的唯一管道。
 *
 * 命名事件（约定）：
 *   records:changed     — 记录增删改
 *   records:scored      — 评分完成
 *   auth:changed        — 登录/登出/试用
 *   settings:changed    — 设置变更
 *   filter:changed      — 过滤/排序条件变更
 *   fetch:progress      — API 获取进度更新
 *   fetch:complete      — API 获取全部完成
 *   fetch:error         — API 获取出错
 *   study-mode:changed  — 人/动物/体外模式切换
 *   prisma:updated      — PRISMA 图需重绘
 */
export class EventBus {
  #listeners = new Map();

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数，接收 payload
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(callback);
    return () => this.off(event, callback); // 返回取消订阅函数
  }

  /**
   * 取消订阅
   */
  off(event, callback) {
    const set = this.#listeners.get(event);
    if (set) set.delete(callback);
  }

  /**
   * 发布事件
   * @param {string} event - 事件名
   * @param {*} [payload] - 携带数据
   */
  emit(event, payload) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(payload); } catch (e) { console.error(`[EventBus] ${event} handler error:`, e); }
    }
  }

  /**
   * 一次性订阅
   */
  once(event, callback) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      callback(payload);
    };
    this.on(event, wrapper);
  }

  /**
   * 清空所有监听器
   */
  clear() {
    this.#listeners.clear();
  }

  /**
   * 列出已订阅的事件名
   */
  get events() {
    return [...this.#listeners.keys()];
  }
}
