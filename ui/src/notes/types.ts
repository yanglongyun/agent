// 列表只带正文开头，详情接口才返回完整正文。
export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  created_at: number;
  updated_at: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}
