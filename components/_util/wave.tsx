/**
 * Wave组件的特点是不生成任何dom的情况下（通过css生成伪元素）实现效果
 */
import * as React from 'react';
import { findDOMNode } from 'react-dom';
import TransitionEvents from 'css-animation/lib/Event'; // 监听css动画
// request animation frame 封装 引入是为了解决下面所提到的相关bug ⬇️
import raf from '../_util/raf';
import { ConfigConsumer, ConfigConsumerProps, CSPConfig } from '../config-provider';

// style标签 里面有wave效果伪元素的css
let styleForPesudo: HTMLStyleElement | null;

// Where el is the DOM element you'd like to test for visibility
function isHidden(element: HTMLElement) {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  return !element || element.offsetParent === null;
}

export default class Wave extends React.Component<{ insertExtraNode?: boolean }> {
  private instance?: {
    cancel: () => void;
  };

  private extraNode: HTMLDivElement;
  private clickWaveTimeoutId: number;
  private animationStartId: number;
  private animationStart: boolean = false;
  private destroy: boolean = false;
  private csp?: CSPConfig;

  // 不是灰色 rgb一样的时候是灰色
  isNotGrey(color: string) {
    const match = (color || '').match(/rgba?\((\d*), (\d*), (\d*)(, [\.\d]*)?\)/);
    if (match && match[1] && match[2] && match[3]) {
      return !(match[1] === match[2] && match[2] === match[3]);
    }
    return true;
  }

  // 真正点击时候执行的操作
  // 将 相关attribute name设置为true 来触发定义在other.less中的css animation
  onClick = (node: HTMLElement, waveColor: string) => {
    if (!node || isHidden(node) || node.className.indexOf('-leave') >= 0) {
      return;
    }
    const { insertExtraNode } = this.props;
    // 需要额外插入的dom insertExtraNode为真 则会生成
    this.extraNode = document.createElement('div');
    const extraNode = this.extraNode;
    extraNode.className = 'ant-click-animating-node';
    const attributeName = this.getAttributeName();
    node.setAttribute(attributeName, 'true');
    // Not white or transparnt or grey
    styleForPesudo = styleForPesudo || document.createElement('style');

    // 如果外边框的颜色不是灰色 白色 就是用默认的primary-color
    // 否则动态添加style 指明border-color
    if (
      waveColor &&
      waveColor !== '#ffffff' &&
      waveColor !== 'rgb(255, 255, 255)' &&
      this.isNotGrey(waveColor) &&
      !/rgba\(\d*, \d*, \d*, 0\)/.test(waveColor) && // any transparent rgba color
      waveColor !== 'transparent'
    ) {
      // Add nonce if CSP exist
      if (this.csp && this.csp.nonce) {
        styleForPesudo.nonce = this.csp.nonce;
      }
      // 动态创建style标签 通过css给 ::after添加边框颜色
      extraNode.style.borderColor = waveColor;
      styleForPesudo.innerHTML = `[ant-click-animating-without-extra-node="true"]:after { border-color: ${waveColor}; }`;
      if (!document.body.contains(styleForPesudo)) {
        document.body.appendChild(styleForPesudo);
      }
    }
    if (insertExtraNode) {
      node.appendChild(extraNode);
    }
    // 添加动画开始监听是为了fix bug # https://github.com/ant-design/ant-design/issues/12942
    TransitionEvents.addStartEventListener(node, this.onTransitionStart);
    // 动画结束后进行resetEffect
    TransitionEvents.addEndEventListener(node, this.onTransitionEnd);
  };

  // 对children dom进行click事件绑定
  bindAnimationEvent = (node: HTMLElement) => {
    // 如果是disabled 就不需要处理点击动画
    if (
      !node ||
      !node.getAttribute ||
      node.getAttribute('disabled') ||
      node.className.indexOf('disabled') >= 0
    ) {
      return;
    }
    // dom点击的时候触发该方法
    const onClick = (e: MouseEvent) => {
      // Fix radio button click twice
      if ((e.target as HTMLElement).tagName === 'INPUT' || isHidden(e.target as HTMLElement)) {
        return;
      }
      // 恢复状态
      this.resetEffect(node);
      // Get wave color from target
      // 根据边框颜色确定 wave 颜色
      const waveColor =
        getComputedStyle(node).getPropertyValue('border-top-color') || // Firefox Compatible
        getComputedStyle(node).getPropertyValue('border-color') ||
        getComputedStyle(node).getPropertyValue('background-color');
      // 下一次runloop执行this.onClick 触发动画
      this.clickWaveTimeoutId = window.setTimeout(() => this.onClick(node, waveColor), 0);
      // 如果10帧 raf 还没有结束，则取消重制
      raf.cancel(this.animationStartId);
      // 标记开始动画
      this.animationStart = true;

      // Render to trigger transition event cost 3 frames. Let's delay 10 frames to reset this.
      // 10帧后 标记动画结束 大约160ms
      this.animationStartId = raf(() => {
        this.animationStart = false;
      }, 10);
    };
    // 给dom添加点击事件
    node.addEventListener('click', onClick, true);
    // instance 有cancel方法，用于Unmount取消事件绑定
    return {
      cancel: () => {
        node.removeEventListener('click', onClick, true);
      },
    };
  };

  // 获取应该添加的html attribute name
  getAttributeName() {
    const { insertExtraNode } = this.props;
    return insertExtraNode ? 'ant-click-animating' : 'ant-click-animating-without-extra-node';
  }

  // 清空children dom的 ::after，清空transition动画监听
  resetEffect(node: HTMLElement) {
    if (!node || node === this.extraNode || !(node instanceof Element)) {
      return;
    }
    const { insertExtraNode } = this.props;
    const attributeName = this.getAttributeName();
    //<button ant-click-animating-without-extra-node="false"></button>
    node.setAttribute(attributeName, 'false'); // edge has bug on `removeAttribute` #14466
    this.removeExtraStyleNode();
    if (insertExtraNode && this.extraNode && node.contains(this.extraNode)) {
      node.removeChild(this.extraNode);
    }
    TransitionEvents.removeStartEventListener(node, this.onTransitionStart);
    TransitionEvents.removeEndEventListener(node, this.onTransitionEnd);
  }

  // fix bug
  onTransitionStart = (e: AnimationEvent) => {
    if (this.destroy) return;

    const node = findDOMNode(this) as HTMLElement;
    if (!e || e.target !== node) {
      return;
    }

    if (!this.animationStart) {
      this.resetEffect(node);
    }
  };

  // 结束动画 resetEffect
  onTransitionEnd = (e: AnimationEvent) => {
    if (!e || e.animationName !== 'fadeEffect') {
      return;
    }
    this.resetEffect(e.target as HTMLElement);
  };
  // 清空style里面的css
  removeExtraStyleNode() {
    if (styleForPesudo) {
      styleForPesudo.innerHTML = '';
    }
  }

  componentDidMount() {
    const node = findDOMNode(this) as HTMLElement;
    if (node.nodeType !== 1) {
      return;
    }
    this.instance = this.bindAnimationEvent(node);
  }

  componentWillUnmount() {
    if (this.instance) {
      this.instance.cancel();
    }
    if (this.clickWaveTimeoutId) {
      clearTimeout(this.clickWaveTimeoutId);
    }

    this.destroy = true;
  }

  renderWave = ({ csp }: ConfigConsumerProps) => {
    const { children } = this.props;
    this.csp = csp;

    return children;
  };

  render() {
    return <ConfigConsumer>{this.renderWave}</ConfigConsumer>;
  }
}
