// 记录正文的 SQL 表达式，owners 与 records 的关键字搜索共用。
// 取出消息和思考的文字块、工具调用参数、工具返回文本；alias 是 messages 表在外层查询里的别名。
// 文字块逐个检查类型：只有对象取 text，纯文本直接使用，其他形态跳过，避免对非 JSON 值取字段而报错。
export function textExpression(alias) {
  if (!/^[a-z_]+$/.test(alias)) {
    throw new Error("别名无效");
  }
  const parts = (path) => `(
    SELECT group_concat(
      CASE part.type
        WHEN 'object' THEN json_extract(part.value, '$.text')
        WHEN 'text' THEN part.value
      END,
      char(10)
    )
    FROM json_each(${alias}.item, '${path}') AS part
  )`;
  return `COALESCE(
    ${parts("$.content")},
    ${parts("$.summary")},
    json_extract(${alias}.item, '$.arguments'),
    json_extract(${alias}.item, '$.output'),
    ''
  )`;
}
