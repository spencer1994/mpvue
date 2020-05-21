// 节流方法，性能优化
import { getComKey } from '../util/index'

// 全局的命名约定，为了节省编译的包大小一律采取形象的缩写，说明如下。
// $c === $child
// $k === $comKey

// 新型的被拍平的数据结构
// {
//   $root: {
//     '1-1'{
//       // ... data
//     },
//     '1.2-1': {
//       // ... data1
//     },
//     '1.2-2': {
//       // ... data2
//     }
//   }
// }

function getVmData (vm) {
  // 确保当前 vm 所有数据被同步
  const dataKeys = [].concat(
    Object.keys(vm._data || {}),
    Object.keys(vm._props || {}),
    Object.keys(vm._mpProps || {}),
    Object.keys(vm._computedWatchers || {})
  )
  return dataKeys.reduce((res, key) => {
    res[key] = vm[key]
    return res
  }, {})
}

function getParentComKey (vm, res = []) {
  const { $parent } = vm || {}
  if (!$parent) return res
  res.unshift(getComKey($parent))
  if ($parent.$parent) {
    return getParentComKey($parent, res)
  }
  return res
}

function formatVmData (vm) {
  const $p = getParentComKey(vm).join(',')
  const $k = $p + ($p ? ',' : '') + getComKey(vm)

  // getVmData 这儿获取当前组件内的所有数据，包含 props、computed 的数据
  // 改动 vue.runtime 所获的的核心能力
  const data = Object.assign(getVmData(vm), { $k, $kk: `${$k},`, $p })
  const key = '$root.' + $k
  const res = { [key]: data }
  return res
}

function collectVmData (vm, res = {}) {
  const { $children: vms } = vm
  if (vms && vms.length) {
    vms.forEach(v => collectVmData(v, res))
  }
  return Object.assign(res, formatVmData(vm))
}

/**
 * 频率控制 返回函数连续调用时，func 执行频率限定为 次 / wait
 * 自动合并 data
 *
 * @param  {function}   func      传入函数
 * @param  {number}     wait      表示时间窗口的间隔
 * @param  {object}     options   如果想忽略开始边界上的调用，传入{leading: false}。
 *                                如果想忽略结尾边界上的调用，传入{trailing: false}
 * @return {function}             返回客户调用函数
 */
function throttle (func, wait, options) {
  let context, args, result
  let timeout = null
  // 上次执行时间点
  let previous = 0
  if (!options) options = {}
  // 延迟执行函数
  function later () {
    // 若设定了开始边界不执行选项，上次执行时间始终为0
    previous = options.leading === false ? 0 : Date.now()
    timeout = null
    result = func.apply(context, args)
    if (!timeout) context = args = null
  }
  return function (handle, data) {
    const now = Date.now()
    // 首次执行时，如果设定了开始边界不执行选项，将上次执行时间设定为当前时间。
    if (!previous && options.leading === false) previous = now
    // 延迟执行时间间隔
    const remaining = wait - (now - previous)
    context = this
    args = args ? [handle, Object.assign(args[1], data)] : [handle, data]
    // 延迟时间间隔remaining小于等于0，表示上次执行至此所间隔时间已经超过一个时间窗口
    // remaining大于时间窗口wait，表示客户端系统时间被调整过
    if (remaining <= 0 || remaining > wait) {
      clearTimeout(timeout)
      timeout = null
      previous = now
      result = func.apply(context, args)
      if (!timeout) context = args = null
    // 如果延迟执行不存在，且没有设定结尾边界不执行选项
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining)
    }
    return result
  }
}

// 优化频繁的 setData: https://mp.weixin.qq.com/debug/wxadoc/dev/framework/performance/tips.html
const throttleSetData = throttle((handle, data) => {
  handle(data)
}, 50)

function getPage (vm) {
  const rootVueVM = vm.$root
  const { mpType = '', page } = rootVueVM.$mp || {}

  // 优化后台态页面进行 setData: https://mp.weixin.qq.com/debug/wxadoc/dev/framework/performance/tips.html
  if (mpType === 'app' || !page || typeof page.setData !== 'function') {
    return
  }
  return page
}

// fixed by huangliangxing
function calcDiff (holder, key, newObj, oldObj) {
  if (newObj === oldObj || newObj === undefined) {
    return
  }

  if (newObj == null || oldObj == null || typeof newObj !== typeof oldObj) {
    holder[key] = newObj
  } else if (Array.isArray(newObj) && Array.isArray(oldObj)) {
    if (newObj.length === oldObj.length) {
      for (let i = 0, len = newObj.length; i < len; ++i) {
        calcDiff(holder, key + '[' + i + ']', newObj[i], oldObj[i])
      }
    } else {
      holder[key] = newObj
    }
  } else if (typeof newObj === 'object' && typeof oldObj === 'object') {
    const newKeys = Object.keys(newObj)
    const oldKeys = Object.keys(oldObj)

    if (newKeys.length !== oldKeys.length) {
      holder[key] = newObj
    } else {
      const allKeysSet = Object.create(null)
      for (let i = 0, len = newKeys.length; i < len; ++i) {
        allKeysSet[newKeys[i]] = true
        allKeysSet[oldKeys[i]] = true
      }
      if (Object.keys(allKeysSet).length !== newKeys.length) {
        holder[key] = newObj
      } else {
        for (let i = 0, len = newKeys.length; i < len; ++i) {
          const k = newKeys[i]
          calcDiff(holder, key + '.' + k, newObj[k], oldObj[k])
        }
      }
    }
  } else if (newObj !== oldObj) {
    holder[key] = newObj
  }
}

// fixed by huangliangxing
function diff (newObj, oldObj) {
  const keys = Object.keys(newObj)
  const diffResult = {}
  for (let i = 0, len = keys.length; i < len; ++i) {
    const k = keys[i]
    const oldKeyPath = k.split('.')
    let oldValue = oldObj[oldKeyPath[0]]
    for (let j = 1, jlen = oldKeyPath.length; j < jlen && oldValue !== undefined; ++j) {
      oldValue = oldValue[oldKeyPath[j]]
    }
    calcDiff(diffResult, k, newObj[k], oldValue)
  }
  return diffResult
}

// fixed by huangliangxing
function deepClone (target) {
  if (typeof target !== 'object') return target

  let obj
  if (!Array.isArray) {
    Array.isArray = function (arg) {
      return Object.prototype.toString.call(arg) === '[object Array];'
    }
  }
  if (Array.isArray(target)) {
    obj = []
  } else {
    obj = {}
  }
  for (const prop in target) {
    // obj.hasOwnProperty 判断某个对象是否含有指定的属性
    // 该方法会忽略掉从原型链上继承的属性
    if (target.hasOwnProperty(prop)) {
      if (typeof target === 'object') {
        obj[prop] = deepClone(target[prop])
      } else {
        obj[prop] = target[prop]
      }
    }
  }
  return obj
}

// fixed by huangliangxing
function isEmptyObject (obj) {
  for (const key in obj) {
    return false
  }
  return true
}

// 优化每次 setData 都传递大量新数据
export function updateDataToMP () {
  // fixed by huangliangxing 对于被销毁的节点，不更新data
  if (this._isDestroyed) {
    return
  }

  const page = getPage(this)
  if (!page) {
    return
  }

  // fixed by huangliangxing
  const data = deepClone(formatVmData(this))
  // fixed by huangliangxing
  const diffData = diff(data, page.data)
  if (!isEmptyObject(diffData)) {
    throttleSetData(page.setData.bind(page), diffData)
  }
}

export function initDataToMP () {
  const page = getPage(this)
  if (!page) {
    return
  }

  // fixed by huangliangxing
  const data = deepClone(collectVmData(this.$root))
  const diffData = diff(data, page.data)
  if (!isEmptyObject(diffData)) {
    page.setData(diffData)
  }
}
