/** 统一响应体：{"code": 0, "data": ..., "message": "ok"} */
export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, data, message };
}
