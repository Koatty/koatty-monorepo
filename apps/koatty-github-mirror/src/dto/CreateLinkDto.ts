import { IsDefined } from 'koatty_validation';
import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

/**
 * POST /api/links → LinkService.create
 */
export class CreateLinkDto {
  @Matches(/^(?:https:\/\/)?(?:github\.com|raw\.githubusercontent\.com|codeload\.github\.com)\//, { message: '请输入支持的 GitHub 地址' })
    @IsNotEmpty({ message: 'url 不能为空' })
    @IsString({ message: 'url 必须是字符串' })
      @MaxLength(4096, { message: 'url 长度不能超过 4096' })
  @IsDefined()
  url!: string;

}
