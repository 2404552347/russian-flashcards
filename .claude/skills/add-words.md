---
name: add-words
description: 从免费词典数据库添加单词到闪卡词库（ECDICT 770K 英汉 / OpenRussian / 德语频率词表）
arguments: '<lang> <level> <count>  — lang: en|ru|de, level: 词包键名, count: 要添加的数量'
---

# add-words — 从词典添加单词

**零 AI token 消耗**，直接从免费词典数据库拉取真实单词。

## 数据源

| 语言 | 数据源 | 大小 | 内容 |
|------|--------|------|------|
| EN | ECDICT (skywind3000) | 811MB SQLite | 340 万英汉词条，含音标、Collins/BNC/COCA 词频、词性 |
| RU | OpenRussian (Badestrand) | 23MB CSV | 俄语单词含重音标记 + 英文释义 + 完整变格变位 |
| DE | German Frequency Words | 待下载 | 5 万高频德语词 + 词频排序 |

## 用法

```
/add-words en level1_foundation 500   # 从 Collins 4-5 星添加 500 个英语高频词
/add-words en level4_gre 500          # 从 Collins 1 星添加 500 个 GRE 级词汇
/add-words ru level5_expert 500       # 从 OpenRussian 添加 500 个俄语专业词
/add-words de level3_b1 500           # 添加 500 个德语 B1 级词（频率排序）
```

## 词包键名参考

### 英语 (en)
- `level1_foundation` — Collins 4-5 星 (~1,600 最常用词)
- `level2_advance` — Collins 3 星 (~1,400 六级词)
- `level3_ielts_toefl` — Collins 2 星 (~2,800 留学词)
- `level4_gre` — Collins 1 星 (~6,500 巅峰词)

### 俄语 (ru)
- `level1_basics`, `level2_foundation`, `level3_intermediate`, `level4_advanced`, `level5_expert`

### 德语 (de)
- `level1_a1`, `level2_a2`, `level3_b1`, `level4_b2`, `level5_c1`, `level6_c2`

## 实现方式

本 skill 调用 `tools/dict_tool.py`:
1. **首次使用需下载词典**: `python3 tools/dict_tool.py download <lang>`
2. **添加单词**: 自动去重（跨所有词包），只添加新词
3. **词频分层**: 英语按 Collins 星级自动匹配词包层级

## 执行命令

```bash
# 下载词典（仅首次需要，约需 1-2 分钟）
python3 tools/dict_tool.py download en    # ~200MB 下载，811MB 解压后

# 添加单词
python3 tools/dict_tool.py add <lang> <level> <count>

# 查看统计
python3 tools/dict_tool.py stats

# 验证 JSON 完整性
python3 tools/dict_tool.py validate
```
