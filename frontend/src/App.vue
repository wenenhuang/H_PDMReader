<template>
  <div id="app">
    <el-container style="height: 100vh; overflow: hidden;">
      <el-header>
        <h1>Mini PDM Reader</h1>
        <div v-if="isLoading" style="margin-left: 20px; color: #fff;">
          <i class="el-icon-loading"></i> 处理中...
        </div>
      </el-header>
      <el-container v-loading="isLoading" style="height: calc(100vh - 60px);">
        <el-aside width="350px" style="display: flex; flex-direction: column; border-right: 1px solid #dcdfe6; background-color: #f0f2f5;">
          <div style="padding: 20px 20px 10px 20px;">
            <el-input
              v-model="searchQuery"
              placeholder="搜索表名/字段名/注释"
              @input="filterTables"
              style="margin-bottom: 10px"
            />
            <el-button @click="uploadFile" type="primary" style="width: 100%; margin-bottom: 10px">上传 PDM 文件</el-button>
            <input ref="fileInput" type="file" accept=".pdm" @change="handleFileUpload" style="display: none" />
            <el-button @click="exportExcel" type="success" style="width: 100%; margin-bottom: 10px">导出 Excel</el-button>
            <el-button @click="exportMarkdown" type="info" style="width: 100%; margin-bottom: 10px">导出 Markdown</el-button>
          </div>
          <div style="flex: 1; overflow-y: auto; padding: 0 20px 20px 20px;">
            <el-tree
              :data="filteredTables"
              :props="{ label: 'name', children: 'children' }"
              @node-click="selectTable"
              default-expand-all
            />
          </div>
        </el-aside>
        <el-main style="padding: 20px; overflow-y: auto;">
          <div v-if="selectedTable">
            <h2>{{ selectedTable.name }}</h2>
            <p>{{ selectedTable.comment }}</p>
            <el-table :data="selectedTable.fields" style="width: 100%">
              <el-table-column prop="name" label="字段名" width="150"></el-table-column>
              <el-table-column prop="type" label="类型" width="100"></el-table-column>
              <el-table-column prop="length" label="长度" width="80"></el-table-column>
              <el-table-column prop="nullable" label="非空" width="80">
                <template #default="scope">
                  {{ scope.row.nullable ? '否' : '是' }}
                </template>
              </el-table-column>
              <el-table-column prop="primaryKey" label="主键" width="80">
                <template #default="scope">
                  {{ scope.row.primaryKey ? '是' : '否' }}
                </template>
              </el-table-column>
              <el-table-column prop="comment" label="注释"></el-table-column>
            </el-table>
          </div>
          <div v-else>
            <p>请选择一个表查看详情</p>
          </div>
          <div style="margin-top: 20px">
            <h3>ER 图</h3>
            <div style="margin-bottom: 10px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px;">
              <el-radio-group v-model="viewMode" size="small" @change="throttledDraw">
                <el-radio-button label="focus">聚焦当前表</el-radio-button>
                <el-radio-button label="all">显示全图 (大数据量慎用)</el-radio-button>
              </el-radio-group>
              <el-divider direction="vertical"></el-divider>
              <el-button size="small" @click="zoomIn" type="primary">放大</el-button>
              <el-button size="small" @click="zoomOut" type="info">缩小</el-button>
              <el-button size="small" @click="resetZoom" type="warning">重置</el-button>
              <span style="margin-left: 10px">缩放: {{ Math.round(zoomLevel * 100) }}%</span>
              <span v-if="viewMode === 'all' && tables.length > 100" style="color: #e6a23c; margin-left: 10px;">
                ⚠️ 当前表较多 ({{ tables.length }}), 渲染可能缓慢
              </span>
            </div>
            <div style="border: 1px solid #ccc; overflow: auto; max-height: 600px; background-color: #fafafa;">
              <canvas
                ref="erCanvas"
                width="1200"
                height="800"
                style="border: 1px solid #ccc; cursor: grab"
                @mousedown="startDrag"
                @mousemove="drag"
                @mouseup="stopDrag"
                @wheel="handleWheel"
              ></canvas>
            </div>
          </div>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'

export default {
  name: 'App',
  setup() {
    const searchQuery = ref('')
    const tables = ref([])
    const filteredTables = ref([])
    const selectedTable = ref(null)
    const fileInput = ref(null)
    const erCanvas = ref(null)
    const relationships = ref([])
    const zoomLevel = ref(1)
    const panOffset = ref({ x: 0, y: 0 })
    const isDragging = ref(false)
    const draggedTableId = ref(null)
    const lastMousePos = ref({ x: 0, y: 0 })
    const drawRequested = ref(false)
    const isLoading = ref(false)
    const viewMode = ref('focus')
    const manualPositions = ref({}) // 存储用户手动拖拽后的表位置
    const currentRenderPositions = ref({}) // 实时记录当前所有元素的渲染坐标

    // 节流绘制函数
    const throttledDraw = () => {
      if (!drawRequested.value) {
        drawRequested.value = true
        requestAnimationFrame(() => {
          drawERDiagram()
          drawRequested.value = false
        })
      }
    }

    const filterTables = () => {
      if (!searchQuery.value) {
        filteredTables.value = tables.value
        return
      }
      filteredTables.value = tables.value.filter(table =>
        table.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        table.comment.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        table.fields.some(field =>
          field.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
          field.comment.toLowerCase().includes(searchQuery.value.toLowerCase())
        )
      )
    }

    const uploadFile = () => {
      fileInput.value.click()
    }

    const handleFileUpload = async (event) => {
      const file = event.target.files[0]
      if (!file) return

      isLoading.value = true
      const formData = new FormData()
      formData.append('pdmFile', file)

      try {
        const response = await axios.post('/api/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        tables.value = response.data.tables
        relationships.value = response.data.relationships
        filteredTables.value = tables.value
        if (tables.value.length > 0) {
          selectedTable.value = tables.value[0]
        }
        isLoading.value = false
        // 重置状态以适应新文件
        manualPositions.value = {}
        resetZoom()
        throttledDraw()
      } catch (error) {
        isLoading.value = false
        console.error('上传失败:', error)
        alert('解析失败，可能是文件过大或格式不兼容。')
      }
    }

    const selectTable = (data) => {
      selectedTable.value = data
      if (viewMode.value === 'focus') {
        throttledDraw()
      }
    }

    const exportExcel = async () => {
      try {
        const response = await axios.get('/api/export/excel', { responseType: 'blob' })
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'data-dictionary.xlsx')
        document.body.appendChild(link)
        link.click()
      } catch (error) {
        console.error('导出 Excel 失败:', error)
      }
    }

    const exportMarkdown = async () => {
      try {
        const response = await axios.get('/api/export/markdown', { responseType: 'blob' })
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'data-dictionary.md')
        document.body.appendChild(link)
        link.click()
      } catch (error) {
        console.error('导出 Markdown 失败:', error)
      }
    }

    const zoomIn = () => {
      zoomLevel.value = Math.min(zoomLevel.value * 1.2, 3)
      requestAnimationFrame(drawERDiagram)
    }

    const zoomOut = () => {
      zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.3)
      requestAnimationFrame(drawERDiagram)
    }

    const resetZoom = () => {
      zoomLevel.value = 1
      panOffset.value = { x: 0, y: 0 }
      manualPositions.value = {} // 重置手动位置
      requestAnimationFrame(drawERDiagram)
    }

    const normalizeKey = (key) => (key || '').toString().trim().toLowerCase()

    const startDrag = (event) => {
      const rect = erCanvas.value.getBoundingClientRect()
      // 计算相对于画布的世界坐标（考虑缩放和平移）
      const worldX = (event.clientX - rect.left - panOffset.value.x) / zoomLevel.value
      const worldY = (event.clientY - rect.top - panOffset.value.y) / zoomLevel.value

      // 检测是否点击了某个表
      let hitTableId = null
      
      // 遍历所有当前正在显示的表位置信息
      for (const id in currentRenderPositions.value) {
        const pos = currentRenderPositions.value[id]
        if (!pos.isField && 
            worldX >= pos.x && worldX <= pos.x + pos.width &&
            worldY >= pos.y && worldY <= pos.y + pos.height) {
          hitTableId = id
          break
        }
      }

      if (hitTableId) {
        draggedTableId.value = hitTableId
      }
      
      isDragging.value = true
      lastMousePos.value = { x: event.clientX, y: event.clientY }
      erCanvas.value.style.cursor = 'grabbing'
    }

    const drag = (event) => {
      if (!isDragging.value) return
      const dx = (event.clientX - lastMousePos.value.x) / zoomLevel.value
      const dy = (event.clientY - lastMousePos.value.y) / zoomLevel.value

      if (draggedTableId.value) {
        // 拖动单个表
        const id = draggedTableId.value
        if (!manualPositions.value[id]) {
          // 如果还没有手动位置，从当前渲染位置初始化
          manualPositions.value[id] = { 
            x: currentRenderPositions.value[id].x, 
            y: currentRenderPositions.value[id].y 
          }
        }
        manualPositions.value[id].x += dx
        manualPositions.value[id].y += dy
      } else {
        // 平移整个画布
        panOffset.value.x += dx * zoomLevel.value
        panOffset.value.y += dy * zoomLevel.value
      }

      lastMousePos.value = { x: event.clientX, y: event.clientY }
      throttledDraw()
    }

    const stopDrag = () => {
      isDragging.value = false
      draggedTableId.value = null
      erCanvas.value.style.cursor = 'grab'
    }

    const handleWheel = (event) => {
      event.preventDefault()
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1
      zoomLevel.value = Math.max(0.3, Math.min(3, zoomLevel.value * zoomFactor))
      throttledDraw()
    }

    const drawERDiagram = () => {
      const canvas = erCanvas.value
      if (!canvas) return

      const ctx = canvas.getContext('2d')

      if (tables.value.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.font = '14px Arial'
        ctx.fillStyle = '#999'
        ctx.fillText('请先上传 PDM 文件', canvas.width / 2 - 50, canvas.height / 2)
        return
      }

      // 确定需要绘制的表和关系
      let tablesToDraw = []
      let relationshipsToDraw = []

      // 获取当前容器的大小作为基准
      const container = canvas.parentElement
      const containerWidth = container.clientWidth - 20
      const containerHeight = 600

      if (viewMode.value === 'focus' && selectedTable.value) {
        const selectedId = normalizeKey(selectedTable.value.id)
        const neighborIds = new Set([selectedId])

        // 查找直接关联的表
        relationships.value.forEach(rel => {
          const parentId = normalizeKey(rel.parentTable)
          const childId = normalizeKey(rel.childTable)
          if (parentId === selectedId) neighborIds.add(childId)
          if (childId === selectedId) neighborIds.add(parentId)
        })

        tablesToDraw = tables.value.filter(t => neighborIds.has(normalizeKey(t.id)))
        relationshipsToDraw = relationships.value.filter(rel =>
          neighborIds.has(normalizeKey(rel.parentTable)) && neighborIds.has(normalizeKey(rel.childTable))
        )
      } else {
        tablesToDraw = tables.value
        relationshipsToDraw = relationships.value
      }

      // 存储表的位置
      const tablePositions = {}

      const tableWidth = 220
      const baseTableHeight = 45
      const fieldHeight = 16
      const padding = 20
      const minGapX = 280
      const minGapY = 80

      // 计算每个表的高度
      const tableHeights = tablesToDraw.map(table => {
        const fieldCount = table.fields.length
        return baseTableHeight + fieldCount * fieldHeight
      })

      // 改进的布局算法：基于关系的分层布局
      const autoPositions = calculateTablePositions(tablesToDraw, relationshipsToDraw, tableHeights, tableWidth, minGapX, minGapY, padding)
      
      // 合并手动调整的位置
      const positions = autoPositions.map((pos, index) => {
        const table = tablesToDraw[index]
        const id = normalizeKey(table.id)
        if (manualPositions.value[id]) {
          return { x: manualPositions.value[id].x, y: manualPositions.value[id].y }
        }
        return pos
      })

      // 更新实时坐标记录
      currentRenderPositions.value = {}

      const setTablePosition = (table, pos) => {
        const id = normalizeKey(table.id)
        const keys = [table.id, table.code, table.name].filter(Boolean)
        const posInfo = { ...pos, table }
        keys.forEach(key => {
          tablePositions[normalizeKey(key)] = posInfo
        })
        currentRenderPositions.value[id] = posInfo
      }

      // 计算画布需要的尺寸（考虑缩放）
      let maxX = Math.max(...positions.map((pos, index) => pos.x + tableWidth)) || 800
      let maxY = Math.max(...positions.map((pos, index) => pos.y + tableHeights[index])) || 600

      // 限制最大尺寸防止浏览器崩溃
      const MAX_CANVAS_SIZE = 8000
      maxX = Math.min(maxX, MAX_CANVAS_SIZE)
      maxY = Math.min(maxY, MAX_CANVAS_SIZE)

      // 自适应尺寸逻辑：如果内容超出了容器，则扩展画布；否则保持容器大小
      const contentWidth = (maxX + padding * 2) * zoomLevel.value
      const contentHeight = (maxY + padding * 2) * zoomLevel.value

      // 考虑平移后的边界
      const requiredWidth = Math.max(containerWidth, contentWidth + Math.abs(panOffset.value.x))
      const requiredHeight = Math.max(containerHeight, contentHeight + Math.abs(panOffset.value.y))

      // 只有当尺寸真正需要改变时才改变
      if (Math.abs(canvas.width - requiredWidth) > 1 || Math.abs(canvas.height - requiredHeight) > 1) {
        canvas.width = requiredWidth
        canvas.height = requiredHeight
      }

      // 清除画布
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // 保存上下文状态并应用变换
      ctx.save()
      ctx.translate(panOffset.value.x, panOffset.value.y)
      ctx.scale(zoomLevel.value, zoomLevel.value)

      // 绘制表
      tablesToDraw.forEach((table, index) => {
        const pos = positions[index]
        const tableHeight = tableHeights[index]

        setTablePosition(table, { x: pos.x, y: pos.y, width: tableWidth, height: tableHeight })

        // 存储字段位置用于精确连线
        table.fields.forEach((field, fIdx) => {
          const fieldY = pos.y + 40 + fIdx * fieldHeight
          const fieldPos = {
            x: pos.x,
            y: fieldY,
            isField: true,
            parentTablePos: { x: pos.x, y: pos.y, width: tableWidth, height: tableHeight }
          }
          tablePositions[normalizeKey(field.id)] = fieldPos
        })

        // 绘制表阴影
        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.fillRect(pos.x + 3, pos.y + 3, tableWidth, tableHeight)

        // 绘制表矩形
        ctx.fillStyle = '#fff'
        ctx.fillRect(pos.x, pos.y, tableWidth, tableHeight)
        ctx.strokeStyle = '#333'
        ctx.lineWidth = 2
        ctx.strokeRect(pos.x, pos.y, tableWidth, tableHeight)

        // 绘制表名背景
        ctx.fillStyle = '#f5f5f5'
        ctx.fillRect(pos.x, pos.y, tableWidth, 30)
        ctx.strokeStyle = '#333'
        ctx.lineWidth = 1
        ctx.strokeRect(pos.x, pos.y, tableWidth, 30)

        // 绘制表名
        ctx.fillStyle = '#333'
        ctx.font = 'bold 14px Arial'
        ctx.fillText(table.name, pos.x + 10, pos.y + 20)

        // 绘制字段
        ctx.font = '12px Arial'
        ctx.fillStyle = '#666'
        table.fields.forEach((field, fieldIndex) => {
          const fieldY = pos.y + 40 + fieldIndex * fieldHeight
          const pkMark = field.primaryKey ? '🔑 ' : ''
          const nullableMark = field.nullable ? '' : '❌ '
          const fieldText = `${pkMark}${nullableMark}${field.name}: ${field.type}`
          ctx.fillText(fieldText, pos.x + 10, fieldY)
        })
      })

      const getTablePos = (refKey) => tablePositions[normalizeKey(refKey)]

      // 绘制关系连线
      relationshipsToDraw.forEach(rel => {
        if (rel.joins && rel.joins.length > 0) {
          // 绘制字段级精确连线
          rel.joins.forEach(join => {
            const pColPos = getTablePos(join.parentColumn)
            const cColPos = getTablePos(join.childColumn)
            
            if (pColPos && cColPos) {
              drawFieldRelationshipLine(ctx, pColPos, cColPos, tableWidth)
            }
          })
        } else {
          // 回退到表级连线
          const parentPos = getTablePos(rel.parentTable)
          const childPos = getTablePos(rel.childTable)
          if (parentPos && childPos) {
            drawRelationshipLine(ctx, parentPos, childPos, tableWidth)
          }
        }
      })

      // 恢复上下文状态
      ctx.restore()

      if (relationships.value.length === 0) {
        ctx.font = '14px Arial'
        ctx.fillStyle = '#999'
        ctx.fillText('当前 PDM 中未检测到外键关系或关系解析失败', 20, canvas.height - 20)
      }
    }

    // 计算表位置的改进算法
    const calculateTablePositions = (tables, relationships, tableHeights, tableWidth, minGapX, minGapY, padding) => {
      const positions = []
      
      // 构建关系图
      const graph = {}
      const reverseGraph = {}

      tables.forEach(table => {
        graph[table.id] = []
        reverseGraph[table.id] = []
      })

      relationships.forEach(rel => {
        if (graph[rel.parentTable]) {
          graph[rel.parentTable].push(rel.childTable)
        }
        if (reverseGraph[rel.childTable]) {
          reverseGraph[rel.childTable].push(rel.parentTable)
        }
      })

      // 分层布局算法
      const layers = []
      const visited = new Set()

      const buildLayers = (tableId, layerIndex = 0) => {
        if (visited.has(tableId)) return
        visited.add(tableId)

        if (!layers[layerIndex]) layers[layerIndex] = []
        layers[layerIndex].push(tableId)

        // 处理子表
        graph[tableId]?.forEach(childId => {
          buildLayers(childId, layerIndex + 1)
        })
      }

      // 从没有父表的表开始
      tables.forEach(table => {
        if (reverseGraph[table.id]?.length === 0) {
          buildLayers(table.id, 0)
        }
      })

      // 处理剩余的表（可能有循环依赖）
      tables.forEach(table => {
        if (!visited.has(table.id)) {
          buildLayers(table.id, 0)
        }
      })

      // 计算每层的位置
      let currentY = padding
      layers.forEach((layer, layerIndex) => {
        let currentX = padding
        const layerHeight = Math.max(...layer.map(tableId => {
          const tableIndex = tables.findIndex(t => t.id === tableId)
          return tableHeights[tableIndex]
        }))

        layer.forEach(tableId => {
          const tableIndex = tables.findIndex(t => t.id === tableId)
          if (tableIndex !== -1) {
            positions[tableIndex] = { x: currentX, y: currentY }
            currentX += tableWidth + minGapX
          }
        })

        currentY += layerHeight + minGapY
      })

      // 处理未分层的表（如果有的话）
      tables.forEach((table, index) => {
        if (!positions[index]) {
          const cols = Math.ceil(Math.sqrt(tables.length))
          const row = Math.floor(index / cols)
          const col = index % cols
          positions[index] = {
            x: padding + col * (tableWidth + minGapX),
            y: currentY + row * (Math.max(...tableHeights) + minGapY)
          }
        }
      })

      return positions
    }

    // 绘制字段级精确连线的函数
    const drawFieldRelationshipLine = (ctx, pColPos, cColPos, tableWidth) => {
      // 决定连接点的 X 坐标（左侧或右侧）
      const pX = pColPos.x < cColPos.x ? pColPos.x + tableWidth : pColPos.x
      const cX = cColPos.x < pColPos.x ? cColPos.x + tableWidth : cColPos.x
      
      // Y 坐标调整为字段行垂直居中 (fieldY 是 40, 56... 行高 16, 文字基线在下部, 减去 4 差不多是中心)
      const pY = pColPos.y - 4
      const cY = cColPos.y - 4

      ctx.beginPath()
      ctx.moveTo(pX, pY)
      // 使用三次贝塞尔曲线使连线更平滑，控制点根据距离自适应
      const distance = Math.abs(cX - pX)
      const cpOffset = Math.min(distance / 2, 150)
      const cp1x = pColPos.x < cColPos.x ? pX + cpOffset : pX - cpOffset
      const cp2x = cColPos.x < pColPos.x ? cX + cpOffset : cX - cpOffset
      
      ctx.bezierCurveTo(cp1x, pY, cp2x, cY, cX, cY)
      
      ctx.strokeStyle = '#409eff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // 绘制终点小圆点表示连接
      ctx.beginPath()
      ctx.arc(cX, cY, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#409eff'
      ctx.fill()
    }

    // 绘制关系连线的改进函数
    const drawRelationshipLine = (ctx, parentPos, childPos, tableWidth) => {
      const parentCenterX = parentPos.x + tableWidth / 2
      const parentCenterY = parentPos.y + parentPos.height / 2
      const childCenterX = childPos.x + tableWidth / 2
      const childCenterY = childPos.y + childPos.height / 2

      // 计算连接点（避免线条穿过表内部）
      const getConnectionPoint = (fromX, fromY, toX, toY, box) => {
        const dx = toX - fromX
        const dy = toY - fromY
        const angle = Math.atan2(dy, dx)

        const halfWidth = box.width / 2
        const halfHeight = box.height / 2

        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        let edgeX, edgeY

        if (Math.abs(cos) > Math.abs(sin)) {
          // 左右边
          edgeX = cos > 0 ? box.x + box.width : box.x
          edgeY = fromY + (edgeX - fromX) * sin / cos
        } else {
          // 上下边
          edgeY = sin > 0 ? box.y + box.height : box.y
          edgeX = fromX + (edgeY - fromY) * cos / sin
        }

        // 确保点在边界内
        edgeX = Math.max(box.x, Math.min(box.x + box.width, edgeX))
        edgeY = Math.max(box.y, Math.min(box.y + box.height, edgeY))

        return { x: edgeX, y: edgeY }
      }

      const parentPoint = getConnectionPoint(parentCenterX, parentCenterY, childCenterX, childCenterY, parentPos)
      const childPoint = getConnectionPoint(childCenterX, childCenterY, parentCenterX, parentCenterY, childPos)

      // 绘制连线
      ctx.beginPath()
      ctx.moveTo(parentPoint.x, parentPoint.y)
      ctx.lineTo(childPoint.x, childPoint.y)
      ctx.strokeStyle = '#409eff'
      ctx.lineWidth = 2
      ctx.stroke()

      // 绘制箭头
      const dx = childPoint.x - parentPoint.x
      const dy = childPoint.y - parentPoint.y
      const angle = Math.atan2(dy, dx)
      const arrowLength = 12

      ctx.beginPath()
      ctx.moveTo(childPoint.x, childPoint.y)
      ctx.lineTo(
        childPoint.x - arrowLength * Math.cos(angle - Math.PI / 6),
        childPoint.y - arrowLength * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(childPoint.x, childPoint.y)
      ctx.lineTo(
        childPoint.x - arrowLength * Math.cos(angle + Math.PI / 6),
        childPoint.y - arrowLength * Math.sin(angle + Math.PI / 6)
      )
      ctx.stroke()
    }

    onMounted(() => {
      // 初始化
    })

    return {
      searchQuery,
      filteredTables,
      selectedTable,
      fileInput,
      erCanvas,
      filterTables,
      uploadFile,
      handleFileUpload,
      selectTable,
      exportExcel,
      exportMarkdown,
      zoomIn,
      zoomOut,
      resetZoom,
      startDrag,
      drag,
      stopDrag,
      handleWheel,
      zoomLevel,
      panOffset,
      isLoading,
      viewMode,
      tables,
      throttledDraw
    }
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.el-main {
  padding: 20px;
}

/* 隐藏 Canvas 溢出 */
canvas {
  display: block;
}
</style>
