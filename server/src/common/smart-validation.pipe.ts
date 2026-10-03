import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { validate, ValidationError, ValidatorOptions } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { REQUIRED_HINTS, translateValidationMessage } from './all-exceptions.filter';

/**
 * 分来源的校验管道（验收反馈第 27 条：标题传数字应返回中文 400，而查询参数要能转换）：
 * - 请求体（body / custom）：不做隐式类型转换，标题传数字、数字传文本一律按中文校验错误返回；
 * - 查询参数 / 路径参数（query / param）：字符串入参需要隐式转换，否则分页参数全部校验失败。
 */
@Injectable()
export class SmartValidationPipe implements PipeTransform<unknown> {
  constructor(private readonly options?: ValidatorOptions) {}

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const metatype = metadata.metatype;
    // 没有 DTO 类型（String / Number / Boolean / Object 等）时原样返回
    if (!metatype || !this.isDto(metatype)) return value;

    const source = metadata.type ?? 'body';
    // 只有查询 / 路径参数需要隐式类型转换（它们天生是字符串）；
    // 请求体不做隐式转换：标题传数字、数字传文本一律按中文校验错误返回
    const entity = plainToInstance(metatype as never, value as never, {
      enableImplicitConversion: source === 'query' || source === 'param',
      exposeDefaultValues: false,
    });
    const errors: ValidationError[] = await validate(entity as object, this.options ?? {});
    if (errors.length > 0) {
      // 每个字段只取「最相关」的一条提示（类型错误优先），且只报一个出错字段，
      // 避免把同一字段的多条约束、或其它字段的提示拼成一长串（验收反馈第 34 条）。
      // 用户确实传了但不合法的字段优先于「没传」的字段（help_type 传错时提示 help_type）。
      const provided = errors.filter((e) => e.value !== undefined && e.value !== null);
      const first = this.pickFieldMessage((provided.length > 0 ? provided : errors)[0]);
      throw new BadRequestException(translateValidationMessage(first));
    }
    // 查询参数是普通对象：把转换后的值写回，控制器才能读到数字
    if (source === 'query' || source === 'param') {
      if (value && typeof value === 'object' && !Array.isArray(value) && entity && typeof entity === 'object') {
        Object.assign(value as object, entity as object);
        return value;
      }
    }
    return entity;
  }

  private isDto(metatype: unknown): boolean {
    if (typeof metatype !== 'function') return false;
    return ![String, Boolean, Number, Array, Object].includes(metatype as never);
  }

  /** 取一个字段最相关的校验提示：类型类约束优先，其次取第一条 */
  private pickFieldMessage(error: ValidationError): string {
    const constraints = error.constraints ?? {};
    const keys = Object.keys(constraints);
    if (keys.length === 0) return '请求参数不正确';
    // 必填字段没有传：给出中文引导（「请选择要反馈的一页分析」），不要说「xxx应为文本」
    if ((error.value === undefined || error.value === null) && REQUIRED_HINTS[error.property]) {
      return REQUIRED_HINTS[error.property];
    }
    const typeKeys = [
      'isString', 'isNumber', 'isInt', 'isBoolean', 'isDate', 'isArray', 'isObject',
      'isEnum', 'isIn', 'isUUID', 'isEmail', 'isNotEmpty', 'isDefined', 'whitelist',
    ];
    const preferred = typeKeys.find((k) => keys.includes(k));
    return String(constraints[preferred ?? keys[0]]);
  }
}
