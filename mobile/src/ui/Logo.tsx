import { Image } from 'react-native'

/**
 * EchoFlow Code 的自有标志：与 app.json 的 icon / adaptiveIcon.foregroundImage /
 * favicon 引用同一份 `assets/icon.png`（蓝云 + `</>`），不再内联上游旧标志
 * 的双 C 路径。图标自带配色、透明底，深浅主题下都能显示；按正方形渲染避免拉伸。
 */
// Metro 会把这个 require 编成打包资源 id。bun 测试通过 mock.module 替换该路径，
// 因此测试进程不会去解析 PNG 字节。
const APP_ICON = require('../../assets/icon.png')

export function Logo({ size = 34, label = 'EchoFlow Code 标志' }: { size?: number; label?: string }) {
  return (
    <Image
      source={APP_ICON}
      style={{ width: size, height: size, resizeMode: 'contain' }}
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  )
}
