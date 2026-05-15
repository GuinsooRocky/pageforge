# H5页面组件设计规则

## 核心原则

营销活动页面优先考虑开发效率和视觉还原度，避免过度工程化。

## 判断规则

### 使用图片
- 复杂视觉效果（渐变、光效、特殊字体）
- 装饰性元素（插图、粒子、背景）
- 固定不变的内容
- CSS难以实现或成本高的效果

### 独立成组件
- 需要交互的元素（按钮、输入框）
- 动态/可配置内容（文案、数据、状态）
- 可复用的UI单元
- 列表/循环渲染的内容

### 快速判断流程

1. 需要交互？→ 组件化
2. 内容动态？→ 组件化
3. 会重复使用？→ 组件化
4. 其他情况 → 优先用图片

### 头部区域两侧按钮规则

> **强制规则**：分析头部区域（页面顶部导航栏/标题栏）时，如果发现两侧有按钮（返回、关闭、设置、更多等），必须遵守：
> - **左侧按钮**：单独成为独立组件，命名如 `HeaderLeftButton`
> - **右侧按钮**：单独成为独立组件，命名如 `HeaderRightButton`
> - 左右按钮**不得合并**为同一组件
> - **中间内容**：不在背景图中的但叠在背景图上方的应为独立组件
> - 拆分时**绝对不包含背景头图**，背景图永远作为独立整图处理

## 常见场景建议

| 场景 | 方案 |
|------|------|
| 头部区域 | 中间内容组件 |
| 头部左侧按钮 | 独立组件 (HeaderLeftButton)，不包含背景图 |
| 头部右侧按钮 | 独立组件 (HeaderRightButton)，不包含背景图 |
| 横向卡片 | 图片 + 滑动容器 |
| 表单区域 | 完全组件化 |
| 商品列表 | 卡片组件循环 |

## 组件关联与层级

### 识别关联的方法
- **空间位置**：紧密相邻的区域通常有关联
- **交互逻辑**：点击A显示B，则A和B有关联
- **数据流向**：共享同一状态的组件应该在同一父组件内

### Hero区域的特点
Hero（英雄区） = 页面主视觉区，特征：
- 最大面积、视觉焦点
- 承载核心信息
- 通常位于首屏

### 关联组件的父子结构
```vue
<!-- ✅ 有关联的组件应在同一父组件内 -->
<HeroSection>
  <HeroPreview :current="selected" />
  <SkinSelector @change="selected = $event" />
</HeroSection>

<!-- ❌ 避免跨组件通信 -->
<HeroPreview :current="selected" />
<SomeOtherWrapper>
  <SkinSelector @change="selected = $event" />
</SomeOtherWrapper>
```

## 实战示例

### ✅ 推荐：实用方案
```vue
<div class="banner">
  <img src="banner-bg.png" />
  <RuleButton @click="handleClick" />
</div>
```

### ❌ 避免：过度拆分
```vue
<Banner>
  <GradientLayer />
  <StarDecoration />
  <TitleText />
  <TitleEffect />
  <SubTitle />
  <RuleButton />
</Banner>
```
