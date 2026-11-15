const pad = (value: number) => String(value).padStart(2, "0");

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 列表里的时间：今天显示时分，昨天显示「昨天」，更早显示月日。 */
export function shortTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  if (sameDay(date, today)) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const yesterday = new Date(now - 86400000);
  if (sameDay(date, yesterday)) {
    return "昨天";
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 动态的发布时间：刚刚、几分钟前、几小时前，超过一天显示日期和时分。 */
export function momentTime(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && sameDay(new Date(at), new Date(now))) {
    return `${hours} 小时前`;
  }
  const date = new Date(at);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, new Date(now - 86400000))) {
    return `昨天 ${clock}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

/** 聊天里的时间分隔：间隔超过 5 分钟才显示。 */
export function chatDivider(at: number, previous: number | null, now = Date.now()) {
  if (previous !== null && at - previous < 5 * 60000) {
    return null;
  }
  const date = new Date(at);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, new Date(now))) {
    return clock;
  }
  if (sameDay(date, new Date(now - 86400000))) {
    return `昨天 ${clock}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}
