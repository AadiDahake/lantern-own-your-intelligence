(function(){"use strict";var Me,T,St,oe,Et,Tt,At,tt,Oe,be,Lt,nt,rt,it,Re={},Pe=[],zn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,$e=Array.isArray;function ee(e,t){for(var n in t)e[n]=t[n];return e}function ot(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function Bn(e,t,n){var r,i,o,s={};for(o in t)o=="key"?r=t[o]:o=="ref"?i=t[o]:s[o]=t[o];if(arguments.length>2&&(s.children=arguments.length>3?Me.call(arguments,2):n),typeof e=="function"&&e.defaultProps!=null)for(o in e.defaultProps)s[o]===void 0&&(s[o]=e.defaultProps[o]);return De(e,s,r,i,null)}function De(e,t,n,r,i){var o={type:e,props:t,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:i??++St,__i:-1,__u:0};return i==null&&T.vnode!=null&&T.vnode(o),o}function se(e){return e.children}function He(e,t){this.props=e,this.context=t}function ue(e,t){if(t==null)return e.__?ue(e.__,e.__i+1):null;for(var n;t<e.__k.length;t++)if((n=e.__k[t])!=null&&n.__e!=null)return n.__e;return typeof e.type=="function"?ue(e):null}function Vn(e){if(e.__P&&e.__d){var t=e.__v,n=t.__e,r=[],i=[],o=ee({},t);o.__v=t.__v+1,T.vnode&&T.vnode(o),st(e.__P,o,t,e.__n,e.__P.namespaceURI,32&t.__u?[n]:null,r,n??ue(t),!!(32&t.__u),i),o.__v=t.__v,o.__.__k[o.__i]=o,$t(r,o,i),t.__e=t.__=null,o.__e!=n&&Ct(o)}}function Ct(e){if((e=e.__)!=null&&e.__c!=null)return e.__e=e.__c.base=null,e.__k.some(function(t){if(t!=null&&t.__e!=null)return e.__e=e.__c.base=t.__e}),Ct(e)}function It(e){(!e.__d&&(e.__d=!0)&&oe.push(e)&&!Ue.__r++||Et!=T.debounceRendering)&&((Et=T.debounceRendering)||Tt)(Ue)}function Ue(){try{for(var e,t=1;oe.length;)oe.length>t&&oe.sort(At),e=oe.shift(),t=oe.length,Vn(e)}finally{oe.length=Ue.__r=0}}function Nt(e,t,n,r,i,o,s,l,d,c,g){var f,a,h,b,w,v,E=r&&r.__k||Pe,y=t.length;for(d=Wn(n,t,E,d,y),f=0;f<y;f++)(h=n.__k[f])!=null&&(a=h.__i!=-1&&E[h.__i]||Re,h.__i=f,v=st(e,h,a,i,o,s,l,d,c,g),b=h.__e,h.ref&&a.ref!=h.ref&&(a.ref&&at(a.ref,null,h),g.push(h.ref,h.__c||b,h)),w==null&&b!=null&&(w=b),4&h.__u?(d=Mt(h,d,e),a.__e&&(a.__e=null)):typeof h.type=="function"&&v!==void 0?d=v:b&&(d=b.nextSibling),h.__u&=-7);return n.__e=w,d}function Wn(e,t,n,r,i){var o,s,l,d,c,g=n.length,f=g,a=0;for(e.__k=new Array(i),o=0;o<i;o++)(s=t[o])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=e.__k[o]=De(null,s,null,null,null):$e(s)?s=e.__k[o]=De(se,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=e.__k[o]=De(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):e.__k[o]=s,d=o+a,s.__=e,s.__b=e.__b+1,l=null,(c=s.__i=Yn(s,n,d,f))!=-1&&(f--,(l=n[c])&&(l.__u|=2)),l==null||l.__v==null?(c==-1&&(i>g?a--:i<g&&a++),typeof s.type!="function"&&(s.__u|=4)):c!=d&&(c==d-1?a--:c==d+1?a++:(c>d?a--:a++,s.__u|=4))):e.__k[o]=null;if(f)for(o=0;o<g;o++)(l=n[o])!=null&&(2&l.__u)==0&&(l.__e==r&&(r=ue(l)),Ht(l,l));return r}function Mt(e,t,n){var r,i;if(typeof e.type=="function"){for(r=e.__k,i=0;r&&i<r.length;i++)r[i]&&(r[i].__=e,t=Mt(r[i],t,n));return t}e.__e!=t&&(t&&e.type&&!t.parentNode&&(t=ue(e)),t=n.insertBefore(e.__e,t||null));do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function Yn(e,t,n,r){var i,o,s,l=e.key,d=e.type,c=t[n],g=c!=null&&(2&c.__u)==0;if(c===null&&l==null||g&&l==c.key&&d==c.type)return n;if(r>(g?1:0)){for(i=n-1,o=n+1;i>=0||o<t.length;)if((c=t[s=i>=0?i--:o++])!=null&&(2&c.__u)==0&&l==c.key&&d==c.type)return s}return-1}function Ot(e,t,n){t[0]=="-"?e.setProperty(t,n??""):e[t]=n==null?"":typeof n!="number"||zn.test(t)?n:n+"px"}function Ge(e,t,n,r,i){var o,s;e:if(t=="style")if(typeof n=="string")e.style.cssText=n;else{if(typeof r=="string"&&(e.style.cssText=r=""),r)for(t in r)n&&t in n||Ot(e.style,t,"");if(n)for(t in n)r&&n[t]==r[t]||Ot(e.style,t,n[t])}else if(t[0]=="o"&&t[1]=="n")o=t!=(t=t.replace(Lt,"$1")),s=t.toLowerCase(),t=s in e||t=="onFocusOut"||t=="onFocusIn"?s.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+o]=n,n?r?n[be]=r[be]:(n[be]=nt,e.addEventListener(t,o?it:rt,o)):e.removeEventListener(t,o?it:rt,o);else{if(i=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&n==1?"":n))}}function Rt(e){return function(t){if(this.l){var n=this.l[t.type+e];if(t[Oe]==null)t[Oe]=nt++;else if(t[Oe]<n[be])return;return n(T.event?T.event(t):t)}}}function st(e,t,n,r,i,o,s,l,d,c){var g,f,a,h,b,w,v,E,y,p,k,x,P,G,H,j,M=t.type;if(t.constructor!==void 0)return null;128&n.__u&&(d=!!(32&n.__u),o=[l=t.__e=n.__e]),(g=T.__b)&&g(t);e:if(typeof M=="function"){f=s.length;try{if(y=t.props,p=M.prototype&&M.prototype.render,k=(g=M.contextType)&&r[g.__c],x=g?k?k.props.value:g.__:r,n.__c?E=(a=t.__c=n.__c).__=a.__E:(p?t.__c=a=new M(y,x):(t.__c=a=new He(y,x),a.constructor=M,a.render=Jn),k&&k.sub(a),a.state||(a.state={}),a.__n=r,h=a.__d=!0,a.__h=[],a._sb=[]),p&&a.__s==null&&(a.__s=a.state),p&&M.getDerivedStateFromProps!=null&&(a.__s==a.state&&(a.__s=ee({},a.__s)),ee(a.__s,M.getDerivedStateFromProps(y,a.__s))),b=a.props,w=a.state,a.__v=t,h)p&&M.getDerivedStateFromProps==null&&a.componentWillMount!=null&&a.componentWillMount(),p&&a.componentDidMount!=null&&a.__h.push(a.componentDidMount);else{if(p&&M.getDerivedStateFromProps==null&&y!==b&&a.componentWillReceiveProps!=null&&a.componentWillReceiveProps(y,x),t.__v==n.__v||!a.__e&&a.shouldComponentUpdate!=null&&a.shouldComponentUpdate(y,a.__s,x)===!1){t.__v!=n.__v&&(a.props=y,a.state=a.__s,a.__d=!1),t.__e=n.__e,t.__k=n.__k,t.__k.some(function(R){R&&(R.__=t)}),Pe.push.apply(a.__h,a._sb),a._sb=[],a.__h.length&&s.push(a),l=ue(n);break e}a.componentWillUpdate!=null&&a.componentWillUpdate(y,a.__s,x),p&&a.componentDidUpdate!=null&&a.__h.push(function(){a.componentDidUpdate(b,w,v)})}if(a.context=x,a.props=y,a.__P=e,a.__e=!1,P=T.__r,G=0,p)a.state=a.__s,a.__d=!1,P&&P(t),g=a.render(a.props,a.state,a.context),Pe.push.apply(a.__h,a._sb),a._sb=[];else do a.__d=!1,P&&P(t),g=a.render(a.props,a.state,a.context),a.state=a.__s;while(a.__d&&++G<25);a.state=a.__s,a.getChildContext!=null&&(r=ee(ee({},r),a.getChildContext())),p&&!h&&a.getSnapshotBeforeUpdate!=null&&(v=a.getSnapshotBeforeUpdate(b,w)),H=g!=null&&g.type===se&&g.key==null?Dt(g.props.children):g,l=Nt(e,$e(H)?H:[H],t,n,r,i,o,s,l,d,c),a.base=t.__e,t.__u&=-161,a.__h.length&&s.push(a),E&&(a.__E=a.__=null)}catch(R){if(s.length=f,t.__v=null,d||o!=null){if(R.then){for(t.__u|=d?160:128;l&&l.nodeType==8&&l.nextSibling;)l=l.nextSibling;o!=null&&(o[o.indexOf(l)]=null),t.__e=l}else if(o!=null)for(j=o.length;j--;)ot(o[j])}else t.__e=n.__e;t.__k==null&&(t.__k=n.__k||[]),R.then||Pt(t),T.__e(R,t,n)}}else o==null&&t.__v==n.__v?(t.__k=n.__k,t.__e=n.__e):l=t.__e=Kn(n.__e,t,n,r,i,o,s,d,c);return(g=T.diffed)&&g(t),128&t.__u?void 0:l}function Pt(e){e&&(e.__c&&(e.__c.__e=!0),e.__k&&e.__k.some(Pt))}function $t(e,t,n){for(var r=0;r<n.length;r++)at(n[r],n[++r],n[++r]);T.__c&&T.__c(t,e),e.some(function(i){try{e=i.__h,i.__h=[],e.some(function(o){o.call(i)})}catch(o){T.__e(o,i.__v)}})}function Dt(e){return typeof e!="object"||e==null||e.__b>0?e:$e(e)?e.map(Dt):e.constructor!==void 0?null:ee({},e)}function Kn(e,t,n,r,i,o,s,l,d){var c,g,f,a,h,b,w,v=n.props||Re,E=t.props,y=t.type;if(y=="svg"?i="http://www.w3.org/2000/svg":y=="math"?i="http://www.w3.org/1998/Math/MathML":i||(i="http://www.w3.org/1999/xhtml"),o!=null){for(c=0;c<o.length;c++)if((h=o[c])&&"setAttribute"in h==!!y&&(y?h.localName==y:h.nodeType==3)){e=h,o[c]=null;break}}if(e==null){if(y==null)return document.createTextNode(E);e=document.createElementNS(i,y,E.is&&E),l&&(T.__m&&T.__m(t,o),l=!1),o=null}if(y==null)v===E||l&&e.data==E||(e.data=E);else{if(o=y=="textarea"&&E.defaultValue!=null?null:o&&Me.call(e.childNodes),!l&&o!=null)for(v={},c=0;c<e.attributes.length;c++)v[(h=e.attributes[c]).name]=h.value;for(c in v)h=v[c],c=="dangerouslySetInnerHTML"?f=h:c=="children"||c in E||c=="value"&&"defaultValue"in E||c=="checked"&&"defaultChecked"in E||Ge(e,c,null,h,i);for(c in E)h=E[c],c=="children"?a=h:c=="dangerouslySetInnerHTML"?g=h:c=="value"?b=h:c=="checked"?w=h:l&&typeof h!="function"||v[c]===h||Ge(e,c,h,v[c],i);if(g)l||f&&(g.__html==f.__html||g.__html==e.innerHTML)||(e.innerHTML=g.__html),t.__k=[];else if(f&&(e.innerHTML=""),Nt(t.type=="template"?e.content:e,$e(a)?a:[a],t,n,r,y=="foreignObject"?"http://www.w3.org/1999/xhtml":i,o,s,o?o[0]:n.__k&&ue(n,0),l,d),o!=null)for(c=o.length;c--;)ot(o[c]);l&&y!="textarea"||(c="value",y=="progress"&&b==null?e.removeAttribute("value"):b!=null&&(b!==e[c]||y=="progress"&&!b||y=="option"&&b!=v[c])&&Ge(e,c,b,v[c],i),c="checked",w!=null&&w!=e[c]&&Ge(e,c,w,v[c],i))}return e}function at(e,t,n){try{if(typeof e=="function"){var r=typeof e.__u=="function";r&&e.__u(),r&&t==null||(e.__u=e(t))}else e.current=t}catch(i){T.__e(i,n)}}function Ht(e,t,n){var r,i;if(T.unmount&&T.unmount(e),(r=e.ref)&&(r.current&&r.current!=e.__e||at(r,null,t)),(r=e.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(o){T.__e(o,t)}r.base=r.__P=r.__n=null}if(r=e.__k)for(i=0;i<r.length;i++)r[i]&&Ht(r[i],t,n||typeof e.type!="function");n||ot(e.__e),e.__c=e.__=e.__e=void 0}function Jn(e,t,n){return this.constructor(e,n)}function Xn(e,t,n){var r,i,o,s;t==document&&(t=document.documentElement),T.__&&T.__(e,t),i=(r=!1)?null:t.__k,o=[],s=[],st(t,e=t.__k=Bn(se,null,[e]),i||Re,Re,t.namespaceURI,i?null:t.firstChild?Me.call(t.childNodes):null,o,i?i.__e:t.firstChild,r,s),$t(o,e,s),e.props.children=null}Me=Pe.slice,T={__e:function(e,t,n,r){for(var i,o,s;t=t.__;)if((i=t.__c)&&!i.__)try{if((o=i.constructor)&&o.getDerivedStateFromError!=null&&(i.setState(o.getDerivedStateFromError(e)),s=i.__d),i.componentDidCatch!=null&&(i.componentDidCatch(e,r||{}),s=i.__d),s)return i.__E=i}catch(l){e=l}throw e}},St=0,He.prototype.setState=function(e,t){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=ee({},this.state),typeof e=="function"&&(e=e(ee({},n),this.props)),e&&ee(n,e),e!=null&&this.__v&&(t&&this._sb.push(t),It(this))},He.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),It(this))},He.prototype.render=se,oe=[],Tt=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,At=function(e,t){return e.__v.__b-t.__v.__b},Ue.__r=0,tt=Math.random().toString(8),Oe="__d"+tt,be="__a"+tt,Lt=/(PointerCapture)$|Capture$/i,nt=0,rt=Rt(!1),it=Rt(!0);var Zn=0;function u(e,t,n,r,i,o){t||(t={});var s,l,d=t;if("ref"in d)for(l in d={},t)l=="ref"?s=t[l]:d[l]=t[l];var c={type:e,props:d,key:n,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Zn,__i:-1,__u:0,__source:i,__self:o};if(typeof e=="function"&&(s=e.defaultProps))for(l in s)d[l]===void 0&&(d[l]=s[l]);return T.vnode&&T.vnode(c),c}var de,L,lt,Ut,_e=0,Gt=[],N=T,qt=N.__b,Ft=N.__r,jt=N.diffed,zt=N.__c,Bt=N.unmount,Vt=N.__;function ye(e,t){N.__h&&N.__h(L,e,_e||t),_e=0;var n=L.__H||(L.__H={__:[],__h:[]});return e>=n.__.length&&n.__.push({}),n.__[e]}function C(e){return _e=1,Wt(Kt,e)}function Wt(e,t,n){var r=ye(de++,2);if(r.t=e,!r.__c&&(r.__=[Kt(void 0,t),function(l){var d=r.__N?r.__N[0]:r.__[0],c=r.t(d,l);d!==c&&(r.__N=[c,r.__[1]],r.__c.setState({}))}],r.__c=L,!L.__f)){var i=function(l,d,c){if(!r.__c.__H)return!0;var g=!1,f=r.__c.props!==l;if(r.__c.__H.__.some(function(h){if(h.__N){g=!0;var b=h.__[0];h.__=h.__N,h.__N=void 0,b!==h.__[0]&&(f=!0)}}),o){var a=o.call(this,l,d,c);return g?a||f:a}return!g||f};L.__f=!0;var o=L.shouldComponentUpdate,s=L.componentWillUpdate;L.componentWillUpdate=function(l,d,c){if(this.__e){var g=o;o=void 0,i(l,d,c),o=g}s&&s.call(this,l,d,c)},L.shouldComponentUpdate=i}return r.__N||r.__}function $(e,t){var n=ye(de++,3);!N.__s&&ut(n.__H,t)&&(n.__=e,n.u=t,L.__H.__h.push(n))}function Qn(e,t){var n=ye(de++,4);!N.__s&&ut(n.__H,t)&&(n.__=e,n.u=t,L.__h.push(n))}function O(e){return _e=5,qe(function(){return{current:e}},[])}function qe(e,t){var n=ye(de++,7);return ut(n.__H,t)&&(n.__=e(),n.__H=t,n.__h=e),n.__}function U(e,t){return _e=8,qe(function(){return e},t)}function er(){var e=ye(de++,11);if(!e.__){for(var t=L.__v;t!==null&&!t.__m&&t.__!==null;)t=t.__;var n=t.__m||(t.__m=[0,0]);e.__="P"+n[0]+"-"+n[1]++}return e.__}function tr(){for(var e;e=Gt.shift();){var t=e.__H;if(e.__P&&t)try{t.__h.some(Fe),t.__h.some(ct),t.__h=[]}catch(n){t.__h=[],N.__e(n,e.__v)}}}N.__b=function(e){L=null,qt&&qt(e)},N.__=function(e,t){e&&t.__k&&t.__k.__m&&(e.__m=t.__k.__m),Vt&&Vt(e,t)},N.__r=function(e){Ft&&Ft(e),de=0;var t=(L=e.__c).__H;t&&(lt===L?(t.__h=[],L.__h=[],t.__.some(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0})):(t.__h.some(Fe),t.__h.some(ct),t.__h=[],de=0)),lt=L},N.diffed=function(e){jt&&jt(e);var t=e.__c;t&&t.__H&&(t.__H.__h.length&&(Gt.push(t)!==1&&Ut===N.requestAnimationFrame||((Ut=N.requestAnimationFrame)||nr)(tr)),t.__H.__.some(function(n){n.u&&(n.__H=n.u,n.u=void 0)})),lt=L=null},N.__c=function(e,t){t.some(function(n){try{n.__h.some(Fe),n.__h=n.__h.filter(function(r){return!r.__||ct(r)})}catch(r){t.some(function(i){i.__h&&(i.__h=[])}),t=[],N.__e(r,n.__v)}}),zt&&zt(e,t)},N.unmount=function(e){Bt&&Bt(e);var t,n=e.__c;n&&n.__H&&(n.__H.__.some(function(r){try{Fe(r)}catch(i){t=i}}),n.__H=void 0,t&&N.__e(t,n.__v))};var Yt=typeof requestAnimationFrame=="function";function nr(e){var t,n=function(){clearTimeout(r),Yt&&cancelAnimationFrame(t),setTimeout(e)},r=setTimeout(n,35);Yt&&(t=requestAnimationFrame(n))}function Fe(e){var t=L,n=e.__c;typeof n=="function"&&(e.__c=void 0,n()),L=t}function ct(e){var t=L;e.__c=e.__(),L=t}function ut(e,t){return!e||e.length!==t.length||t.some(function(n,r){return n!==e[r]})}function Kt(e,t){return typeof t=="function"?t(e):t}const rr=[["theme","dark","light","appearance","mode","colour","color"],["username","displayname","name","profile","account","handle"],["signout","logout","signin","login","session"],["billing","invoice","payment","plan","subscription"],["key","token","credential","secret","apikey"],["member","team","teammate","invite","organisation","organization","workspace"]];new Map(rr.flatMap(e=>e.map(t=>[Jt(t),Jt(e[0])])));function Jt(e){let t=e;return t.length>4&&t.endsWith("ies")?`${t.slice(0,-3)}y`:(t.length>4&&t.endsWith("ing")?t=t.slice(0,-3):t.length>4&&t.endsWith("ed")||t.length>3&&t.endsWith("es")?t=t.slice(0,-2):t.length>3&&t.endsWith("s")&&(t=t.slice(0,-1)),t.length>4&&t.endsWith("e")&&(t=t.slice(0,-1)),t)}function ir(e){return e.length>=24?!0:/\d/.test(e)}function ve(e){let t;try{t=new URL(e,"http://site.invalid").pathname}catch{t=e.split(/[?#]/)[0]??"/"}const n=t.split("/").filter(r=>r!=="").map(r=>ir(decodeURIComponent(r))?":id":r);return n.length===0?"/":`/${n.join("/")}`}function or(e,t){if(!e)return;const n=e.trim();if(!(n===""||/^(mailto:|tel:|javascript:|data:|#)/i.test(n)))try{const r=t?new URL(t):null,i=new URL(n,r??"http://site.invalid"),o=ve(i.toString());return!r||i.origin===r.origin||i.origin==="http://site.invalid"?o:`${i.origin}${o}`}catch{return}}function dt(e){return e.replace(/\s+/g," ").trim().toLowerCase()}function je(e){return[e.role.toLowerCase(),dt(e.name),e.landmark??"",e.href??""].join("|")}function we(e,t){const n={role:e.role,name:e.name};e.landmark&&(n.landmark=e.landmark);const r=or(e.href,t);return r&&(n.href=r),n}function sr(e,t){return!(e.role.toLowerCase()!==t.role.toLowerCase()||dt(e.name)!==dt(t.name)||e.href&&t.href&&e.href!==t.href||e.landmark&&t.landmark&&e.landmark!==t.landmark)}function ar(e){return/^\+[1-9]\d{6,14}$/.test(e)}const lr=40;function cr(e){if(e.length>lr)return null;const t=e.trim().replace(/^(\+\d{1,3})[\s.-]*\(\s*0\s*\)/,"$1");if(/\(\s*0\s*\)/.test(t))return null;const n=t.replace(/[\s().-]/g,"");return ar(n)?n:null}function ur(e=document){const t=e.documentElement?.getBoundingClientRect();return!!(t&&t.width+t.height>0)}function te(e){if(!e||!e.isConnected)return!1;const t=e.ownerDocument;if(!t||!ur(t))return!0;const n=e.getBoundingClientRect();if(n.width<=0||n.height<=0)return!1;const r=t.defaultView,i=r?.innerWidth??0,o=r?.innerHeight??0;return n.bottom>-o&&n.right>-i&&n.top<o*2&&n.left<i*2}let Xt=!1;const pt=new Set;function dr(){if(!(Xt||typeof history>"u")){Xt=!0;for(const e of["pushState","replaceState"]){const t=history[e];history[e]=function(...r){const i=t.apply(this,r);for(const o of pt)o();return i}}}}function Zt(e){dr();let t=location.href;const n=()=>{location.href!==t&&(t=location.href,e())};return pt.add(n),addEventListener("popstate",n),addEventListener("hashchange",n),()=>{pt.delete(n),removeEventListener("popstate",n),removeEventListener("hashchange",n)}}function pr(e,t=300,n=document.body){if(typeof MutationObserver>"u")return()=>{};let r;const i=new MutationObserver(()=>{r&&clearTimeout(r),r=setTimeout(e,t)});return i.observe(n,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style","hidden","aria-hidden"]}),()=>{r&&clearTimeout(r),i.disconnect()}}function Qt(e=300,t=1500,n=document.body){return new Promise(r=>{let i=!1,o,s;const l=typeof MutationObserver>"u"||!n?null:new MutationObserver(()=>c()),d=()=>{i||(i=!0,o&&clearTimeout(o),s&&clearTimeout(s),l?.disconnect(),r())},c=()=>{o&&clearTimeout(o),o=setTimeout(d,e)};l&&n&&(l.observe(n,{childList:!0,subtree:!0,attributes:!0}),s=setTimeout(d,t)),c()})}function fr(e,t=300){const n=Zt(()=>setTimeout(e,t)),r=pr(e,t);return()=>{n(),r()}}const hr=3,gr=8e3,mr=2500;class br{constructor(t){this.deps=t,this.state="DONE",this.steps=[],this.index=0,this.scan=null,this.lookup=new Map,this.target=null,this.message=null,this.unwatch=null,this.replanning=!1,this.recoveries=0,this.binding=null,this.left=null,this.onUserEvent=n=>{if(this.state!=="SPOTLIGHTING"||!this.target)return;const r=this.steps[this.index];if(r&&_r(n,this.target)){if(n.type==="pointerdown"){if(r.advanceOn!=="click"&&r.advanceOn!=="navigation")return;this.enterVerifying();return}if(yr(r.advanceOn,n.type)){if(n.type==="keydown"){const i=n.key;if(i!=="Enter"&&i!==" "&&i!=="Spacebar")return}this.enterVerifying()}}},this.onPageChanged=()=>{if(this.state==="DONE"||this.state==="FAILED"||this.replanning)return;if(this.binding){this.binding.attempt();return}if(this.state!=="SPOTLIGHTING")return;const n=this.steps[this.index];if(!n||te(this.target))return;this.adoptScan(this.deps.rescan());const r=this.resolve(n);if(te(r)){this.target=r,this.transition("SPOTLIGHTING");return}this.recover()},this.doc=t.doc??document,this.settleMs=t.settleMs??300,this.bindTimeoutMs=t.bindTimeoutMs??null}get snapshot(){return{state:this.state,stepIndex:this.index,total:this.steps.length,step:this.steps[this.index]??null,target:this.target,message:this.message}}start(t,n){this.stopListening(),this.steps=n.map(r=>tn(r,t)),this.index=0,this.message=null,this.recoveries=0,this.adoptScan(t);for(const r of["pointerdown","click","keydown","input","change"])this.doc.addEventListener(r,this.onUserEvent,!0);this.deps.watch&&(this.unwatch=this.deps.watch(this.onPageChanged)),this.enterSpotlight()}next(){this.state!=="SPOTLIGHTING"&&this.state!=="VERIFYING"||this.enterSnapshot()}lost(){this.state==="SPOTLIGHTING"&&this.recover()}stop(){this.stopListening(),this.target=null,this.transition("DONE")}dispose(){this.stopListening()}stopListening(){this.binding=null;for(const t of["pointerdown","click","keydown","input","change"])this.doc.removeEventListener(t,this.onUserEvent,!0);this.unwatch?.(),this.unwatch=null}adoptScan(t){this.scan=t,this.lookup=t.lookup}transition(t){this.state=t,this.deps.onChange(this.snapshot)}resolve(t){if(!this.scan)return null;const n=vr(this.scan,t,t.target);if(n)return t.target=n,this.lookup.get(n)??null;if(t.control)return null;const r=t.target?this.lookup.get(t.target)??null:null;return te(r)?r:null}enterSpotlight(t=null){this.binding=null;const n=this.steps[this.index];if(!n){this.stopListening(),this.target=null,this.transition("DONE");return}const r=this.resolve(n);if(!te(r)){this.target=null,this.recover();return}this.target=r,this.message=t,this.recoveries=0,this.transition("SPOTLIGHTING")}enterVerifying(){this.left={href:this.href(),signature:this.scan?en(this.scan):""},this.target=null,this.transition("VERIFYING"),this.settle().then(()=>{this.state==="VERIFYING"&&this.enterSnapshot()})}href(){return this.doc.defaultView?.location?.href??""}settle(){return this.deps.settle?this.deps.settle():Qt(this.settleMs,1500,this.doc.body)}async enterSnapshot(){const t=this.steps[this.index];if(this.target=null,this.transition("SNAPSHOTTING"),this.index+=1,this.index>=this.steps.length){this.stopListening(),this.transition("DONE");return}const n=t?.advanceOn==="navigation";await this.bindNext(n?gr:mr,n)}arrived(t){const n=this.left;return n?this.href()===n.href?!1:en(t)!==n.signature:!0}bindNext(t,n){return new Promise(r=>{const i=this.bindTimeoutMs??t;let o;const s=()=>{o&&clearTimeout(o),this.binding=null,r()},l=()=>{const d=this.steps[this.index];if(!d)return!0;const c=this.deps.rescan();if(n&&!this.arrived(c))return!1;this.adoptScan(c);const g=this.resolve(d);return te(g)?(this.enterSpotlight(),!0):!1};if(l()){s();return}this.binding={attempt:()=>{l()&&s()}},o=setTimeout(()=>{this.binding!==null&&(this.binding=null,this.settle().then(()=>{if(this.state!=="SNAPSHOTTING"){r();return}if(l()){r();return}this.recover().then(r,r)}))},i)})}async recover(){if(!this.replanning){if(this.recoveries>=hr){this.message="That control is no longer on the page.",this.stopListening(),this.target=null,this.transition("FAILED");return}this.recoveries+=1,this.replanning=!0,this.target=null,this.binding=null,this.transition("SNAPSHOTTING");try{await this.settle();const t=this.steps[this.index];this.adoptScan(this.deps.rescan());const n=t?this.resolve(t):null;if(te(n)){this.replanning=!1,this.enterSpotlight();return}const r=this.steps.length,i=await this.deps.replan(this.index);if(!i||i.steps.length===0){this.message="That control is no longer on the page.",this.stopListening(),this.transition("FAILED");return}this.steps=[...this.steps.slice(0,this.index),...i.steps.map(l=>tn(l,i))],this.adoptScan(i),this.replanning=!1;const o=i.routeChanged===!0||this.steps.length!==r,s=this.steps.length-this.index;this.enterSpotlight(o?`The route changed: ${s} step${s===1?"":"s"} to go.`:null)}catch{this.message="Guidance stopped because the page changed.",this.stopListening(),this.transition("FAILED")}finally{this.replanning=!1}}}}function _r(e,t){return(typeof e.composedPath=="function"?e.composedPath():[]).includes(t)?!0:e.target instanceof Node&&t.contains(e.target)}function yr(e,t){switch(e){case"click":return t==="click"||t==="keydown";case"input":return t==="input"||t==="change";case"navigation":return t==="click"||t==="keydown";case"manual":return!1}}function en(e){const t=e.page.affordances.map(n=>je(we(n,e.page.url)));return`${e.page.title}
${t.sort().join(`
`)}`}function tn(e,t){const n={...e};if(n.control||!n.target)return n;const r=t.page.affordances.find(i=>i.id===n.target);return r&&(n.control={...we(r,t.page.url),route:ve(t.page.url)}),n}function vr(e,t,n=null){const r=t.control??null;if(!r||!r.name.trim())return null;const i=je(r);let o=null,s=null;for(const l of e.page.affordances){const d=we(l,e.page.url);if(sr(d,r)&&te(e.lookup.get(l.id)))if(je(d)===i){if(l.id===n)return l.id;o===null&&(o=l.id)}else s===null&&(s=l.id)}return o??s}const ze=8,wr=12,xr=260,nn=14;class kr{constructor(t,n){this.host=t,this.handlers=n,this.view=null,this.frame=0,this.open=!1,this.resizeObserver=null,this.mutationObserver=null,this.schedule=()=>{this.frame||(this.frame=requestAnimationFrame(()=>{this.frame=0,this.reposition()}))};const{root:r,hole:i,ring:o,bubble:s,counter:l,text:d,advance:c,stop:g}=Sr();this.root=r,this.hole=i,this.ring=o,this.bubble=s,this.counter=l,this.text=d,this.advance=c,this.stop=g,this.advance.addEventListener("click",()=>{this.view&&(this.view.isLast?this.handlers.onDone():this.handlers.onNext())}),this.stop.addEventListener("click",()=>this.handlers.onStop()),this.host.appendChild(this.root)}show(t){if(!te(t.target)){this.hide(),this.handlers.onLost?.();return}const n=t.target.getBoundingClientRect();(n.top<8||n.left<8||n.bottom>window.innerHeight-8||n.right>window.innerWidth-8)&&t.target.scrollIntoView({block:"center",inline:"center",behavior:"auto"});const i=this.view?.target??null;this.view=t,this.counter.textContent=`Step ${t.index+1} of ${t.total}`,this.root.dataset.plStep=String(t.index+1),this.root.dataset.plTotal=String(t.total),this.text.textContent=t.caption,this.advance.textContent=t.isLast?"Done":"Next",this.advance.hidden=!0,this.root.classList.toggle("pl-spot--busy",!!t.busy),this.open||(this.open=!0,Er(this.root),addEventListener("scroll",this.schedule,!0),addEventListener("resize",this.schedule),this.watchLayout()),i!==t.target&&this.follow(t.target),this.reposition()}follow(t){this.resizeObserver?.disconnect(),this.resizeObserver=null,!(typeof ResizeObserver>"u")&&(this.resizeObserver=new ResizeObserver(()=>this.schedule()),this.resizeObserver.observe(t))}watchLayout(){typeof MutationObserver>"u"||!document.body||(this.mutationObserver=new MutationObserver(()=>this.schedule()),this.mutationObserver.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style","hidden","aria-hidden","open"]}))}hide(){this.view=null,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.mutationObserver?.disconnect(),this.mutationObserver=null,delete this.root.dataset.plStep,delete this.root.dataset.plTotal,this.open&&(this.open=!1,Tr(this.root),removeEventListener("scroll",this.schedule,!0),removeEventListener("resize",this.schedule),this.frame&&cancelAnimationFrame(this.frame),this.frame=0)}destroy(){this.hide(),this.root.remove()}reposition(){if(!this.view)return;if(!te(this.view.target)){this.hide(),this.handlers.onLost?.();return}const t=this.view.target.getBoundingClientRect(),n=innerWidth,r=innerHeight,i=Math.max(t.left-ze,4),o=Math.max(t.top-ze,4),s=Math.max(t.width+ze*2,12),l=Math.max(t.height+ze*2,12);for(const h of[this.hole,this.ring])h.setAttribute("x",String(i)),h.setAttribute("y",String(o)),h.setAttribute("width",String(Math.min(s,n-i-4))),h.setAttribute("height",String(Math.min(l,r-o-4))),h.setAttribute("rx",String(wr));const d=o+l+nn,c=this.bubble.offsetHeight||120,g=d+c<r,f=g?d:Math.max(o-nn-c,8),a=Math.min(Math.max(i,8),Math.max(n-xr-8,8));this.bubble.dataset.side=g?"below":"above",this.bubble.style.transform=`translate(${Math.round(a)}px, ${Math.round(f)}px)`}}function Sr(){const e=document.createElement("div");e.className="pl-spot",e.setAttribute("popover","manual");const t=document.createElementNS("http://www.w3.org/2000/svg","svg");t.setAttribute("class","pl-spot__svg"),t.setAttribute("aria-hidden","true");const n=document.createElementNS("http://www.w3.org/2000/svg","defs"),r=document.createElementNS("http://www.w3.org/2000/svg","mask");r.setAttribute("id","pl-spot-mask");const i=document.createElementNS("http://www.w3.org/2000/svg","rect");i.setAttribute("width","100%"),i.setAttribute("height","100%"),i.setAttribute("fill","white");const o=document.createElementNS("http://www.w3.org/2000/svg","rect");o.setAttribute("fill","black"),r.append(i,o),n.append(r);const s=document.createElementNS("http://www.w3.org/2000/svg","rect");s.setAttribute("class","pl-spot__scrim"),s.setAttribute("width","100%"),s.setAttribute("height","100%"),s.setAttribute("mask","url(#pl-spot-mask)");const l=document.createElementNS("http://www.w3.org/2000/svg","rect");l.setAttribute("class","pl-spot__ring"),t.append(n,s,l);const d=document.createElement("div");d.className="pl-spot__bubble";const c=document.createElement("span");c.className="pl-spot__counter";const g=document.createElement("p");g.className="pl-spot__caption";const f=document.createElement("div");f.className="pl-spot__actions";const a=document.createElement("button");a.type="button",a.className="pl-btn pl-btn--quiet",a.textContent="Skip";const h=document.createElement("button");return h.type="button",h.className="pl-btn pl-btn--accent",h.textContent="Next",h.hidden=!0,f.append(a,h),d.append(c,g,f),e.append(t,d),{root:e,hole:o,ring:l,bubble:d,counter:c,text:g,advance:h,stop:a}}function Er(e){const t=e;if(typeof t.showPopover=="function")try{t.showPopover();return}catch{}e.classList.add("pl-spot--fallback")}function Tr(e){const t=e;if(typeof t.hidePopover=="function")try{t.hidePopover()}catch{}e.classList.remove("pl-spot--fallback")}var Ar=Object.prototype.toString;function Lr(e){return typeof e=="function"||Ar.call(e)==="[object Function]"}function Cr(e){var t=Number(e);return isNaN(t)?0:t===0||!isFinite(t)?t:(t>0?1:-1)*Math.floor(Math.abs(t))}var Ir=Math.pow(2,53)-1;function Nr(e){var t=Cr(e);return Math.min(Math.max(t,0),Ir)}function K(e,t){var n=Array,r=Object(e);if(e==null)throw new TypeError("Array.from requires an array-like object - not null or undefined");for(var i=Nr(r.length),o=Lr(n)?Object(new n(i)):new Array(i),s=0,l;s<i;)l=r[s],o[s]=l,s+=1;return o.length=i,o}function xe(e){"@babel/helpers - typeof";return xe=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(t){return typeof t}:function(t){return t&&typeof Symbol=="function"&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},xe(e)}function Mr(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function Or(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,rn(r.key),r)}}function Rr(e,t,n){return t&&Or(e.prototype,t),Object.defineProperty(e,"prototype",{writable:!1}),e}function Pr(e,t,n){return t=rn(t),t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function rn(e){var t=$r(e,"string");return xe(t)=="symbol"?t:t+""}function $r(e,t){if(xe(e)!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t);if(xe(r)!="object")return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)}var Dr=(function(){function e(){var t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:[];Mr(this,e),Pr(this,"items",void 0),this.items=t}return Rr(e,[{key:"add",value:function(n){return this.has(n)===!1&&this.items.push(n),this}},{key:"clear",value:function(){this.items=[]}},{key:"delete",value:function(n){var r=this.items.length;return this.items=this.items.filter(function(i){return i!==n}),r!==this.items.length}},{key:"forEach",value:function(n){var r=this;this.items.forEach(function(i){n(i,i,r)})}},{key:"has",value:function(n){return this.items.indexOf(n)!==-1}},{key:"size",get:function(){return this.items.length}}])})();const Hr=typeof Set>"u"?Set:Dr;function D(e){var t;return(t=e.localName)!==null&&t!==void 0?t:e.tagName.toLowerCase()}var Ur={article:"article",aside:"complementary",button:"button",datalist:"listbox",dd:"definition",details:"group",dialog:"dialog",dt:"term",fieldset:"group",figure:"figure",form:"form",footer:"contentinfo",h1:"heading",h2:"heading",h3:"heading",h4:"heading",h5:"heading",h6:"heading",header:"banner",hr:"separator",html:"document",legend:"legend",li:"listitem",math:"math",main:"main",menu:"list",nav:"navigation",ol:"list",optgroup:"group",option:"option",output:"status",progress:"progressbar",section:"region",summary:"button",table:"table",tbody:"rowgroup",textarea:"textbox",tfoot:"rowgroup",td:"cell",th:"columnheader",thead:"rowgroup",tr:"row",ul:"list"},Gr={caption:new Set(["aria-label","aria-labelledby"]),code:new Set(["aria-label","aria-labelledby"]),deletion:new Set(["aria-label","aria-labelledby"]),emphasis:new Set(["aria-label","aria-labelledby"]),generic:new Set(["aria-label","aria-labelledby","aria-roledescription"]),insertion:new Set(["aria-label","aria-labelledby"]),none:new Set(["aria-label","aria-labelledby"]),paragraph:new Set(["aria-label","aria-labelledby"]),presentation:new Set(["aria-label","aria-labelledby"]),strong:new Set(["aria-label","aria-labelledby"]),subscript:new Set(["aria-label","aria-labelledby"]),superscript:new Set(["aria-label","aria-labelledby"])};function qr(e,t){return["aria-atomic","aria-busy","aria-controls","aria-current","aria-description","aria-describedby","aria-details","aria-dropeffect","aria-flowto","aria-grabbed","aria-hidden","aria-keyshortcuts","aria-label","aria-labelledby","aria-live","aria-owns","aria-relevant","aria-roledescription"].some(function(n){var r;return e.hasAttribute(n)&&!((r=Gr[t])!==null&&r!==void 0&&r.has(n))})}function on(e,t){return qr(e,t)}function Fr(e){var t=zr(e);if(t===null||ft.indexOf(t)!==-1){var n=jr(e);if(ft.indexOf(t||"")===-1||on(e,n||""))return n}return t}function jr(e){var t=Ur[D(e)];if(t!==void 0)return t;switch(D(e)){case"a":case"area":case"link":if(e.hasAttribute("href"))return"link";break;case"img":return e.getAttribute("alt")===""&&!on(e,"img")?"presentation":"img";case"input":{var n=e,r=n.type;switch(r){case"button":case"image":case"reset":case"submit":return"button";case"checkbox":case"radio":return r;case"range":return"slider";case"email":case"tel":case"text":case"url":return e.hasAttribute("list")?"combobox":"textbox";case"search":return e.hasAttribute("list")?"combobox":"searchbox";case"number":return"spinbutton";default:return null}}case"select":return e.hasAttribute("multiple")||e.size>1?"listbox":"combobox"}return null}function zr(e){var t=e.getAttribute("role");if(t!==null){var n=t.trim().split(" ")[0];if(n.length>0)return n}return null}var ft=["presentation","none"];function A(e){return e!==null&&e.nodeType===e.ELEMENT_NODE}function sn(e){return A(e)&&D(e)==="caption"}function Be(e){return A(e)&&D(e)==="input"}function Br(e){return A(e)&&D(e)==="optgroup"}function Vr(e){return A(e)&&D(e)==="select"}function Wr(e){return A(e)&&D(e)==="table"}function Yr(e){return A(e)&&D(e)==="textarea"}function Kr(e){var t=e.ownerDocument===null?e:e.ownerDocument,n=t.defaultView;if(n===null)throw new TypeError("no window available");return n}function Jr(e){return A(e)&&D(e)==="fieldset"}function Xr(e){return A(e)&&D(e)==="legend"}function Zr(e){return A(e)&&D(e)==="slot"}function Qr(e){return A(e)&&e.ownerSVGElement!==void 0}function ei(e){return A(e)&&D(e)==="svg"}function ti(e){return Qr(e)&&D(e)==="title"}function ht(e,t){if(A(e)&&e.hasAttribute(t)){var n=e.getAttribute(t).split(" "),r=e.getRootNode?e.getRootNode():e.ownerDocument;return n.map(function(i){return r.getElementById(i)}).filter(function(i){return i!==null})}return[]}function ne(e,t){return A(e)?t.indexOf(Fr(e))!==-1:!1}function ni(e){return e.trim().replace(/\s\s+/g," ")}function ri(e,t){if(!A(e))return!1;if(e.hasAttribute("hidden")||e.getAttribute("aria-hidden")==="true")return!0;var n=t(e);return n.getPropertyValue("display")==="none"||n.getPropertyValue("visibility")==="hidden"}function ii(e){return ne(e,["button","combobox","listbox","textbox"])||an(e,"range")}function an(e,t){if(!A(e))return!1;switch(t){case"range":return ne(e,["meter","progressbar","scrollbar","slider","spinbutton"]);default:throw new TypeError("No knowledge about abstract role '".concat(t,"'. This is likely a bug :("))}}function ln(e,t){var n=K(e.querySelectorAll(t));return ht(e,"aria-owns").forEach(function(r){n.push.apply(n,K(r.querySelectorAll(t)))}),n}function oi(e){return Vr(e)?e.selectedOptions||ln(e,"[selected]"):ln(e,'[aria-selected="true"]')}function si(e){return ne(e,ft)}function ai(e){return sn(e)}function li(e){return ne(e,["button","cell","checkbox","columnheader","gridcell","heading","label","legend","link","menuitem","menuitemcheckbox","menuitemradio","option","radio","row","rowheader","switch","tab","tooltip","treeitem"])}function ci(e){return!1}function ui(e){return Be(e)||Yr(e)?e.value:e.textContent||""}function cn(e){var t=e.getPropertyValue("content");return/^["'].*["']$/.test(t)?t.slice(1,-1):""}function un(e){var t=D(e);return t==="button"||t==="input"&&e.getAttribute("type")!=="hidden"||t==="meter"||t==="output"||t==="progress"||t==="select"||t==="textarea"}function dn(e){if(un(e))return e;var t=null;return e.childNodes.forEach(function(n){if(t===null&&A(n)){var r=dn(n);r!==null&&(t=r)}}),t}function di(e){if(e.control!==void 0)return e.control;var t=e.getAttribute("for");return t!==null?e.ownerDocument.getElementById(t):dn(e)}function pi(e){var t=e.labels;if(t===null)return t;if(t!==void 0)return K(t);if(!un(e))return null;var n=e.ownerDocument;return K(n.querySelectorAll("label")).filter(function(r){return di(r)===e})}function fi(e){var t=e.assignedNodes();return t.length===0?K(e.childNodes):t}function hi(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=new Hr,r=typeof Map>"u"?void 0:new Map,i=Kr(e),o=t.compute,s=o===void 0?"name":o,l=t.computedStyleSupportsPseudoElements,d=l===void 0?t.getComputedStyle!==void 0:l,c=t.getComputedStyle,g=c===void 0?i.getComputedStyle.bind(i):c,f=t.hidden,a=f===void 0?!1:f,h=function(k,x){if(x!==void 0)throw new Error("use uncachedGetComputedStyle directly for pseudo elements");if(r===void 0)return g(k);var P=r.get(k);if(P)return P;var G=g(k,x);return r.set(k,G),G};function b(p,k){var x="";if(A(p)&&d){var P=g(p,"::before"),G=cn(P);x="".concat(G," ").concat(x)}var H=Zr(p)?fi(p):K(p.childNodes).concat(ht(p,"aria-owns"));if(H.forEach(function(R){var Z=y(R,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!1,recursion:!0}),q=A(R)?h(R).getPropertyValue("display"):"inline",re=q!=="inline"?" ":"";x+="".concat(re).concat(Z).concat(re)}),A(p)&&d){var j=g(p,"::after"),M=cn(j);x="".concat(x," ").concat(M)}return x.trim()}function w(p,k){var x=p.getAttributeNode(k);return x!==null&&!n.has(x)&&x.value.trim()!==""?(n.add(x),x.value):null}function v(p){return A(p)?w(p,"title"):null}function E(p){if(!A(p))return null;if(Jr(p)){n.add(p);for(var k=K(p.childNodes),x=0;x<k.length;x+=1){var P=k[x];if(Xr(P))return y(P,{isEmbeddedInLabel:!1,isReferenced:!1,recursion:!1})}}else if(Wr(p)){n.add(p);for(var G=K(p.childNodes),H=0;H<G.length;H+=1){var j=G[H];if(sn(j))return y(j,{isEmbeddedInLabel:!1,isReferenced:!1,recursion:!1})}}else if(ei(p)){n.add(p);for(var M=K(p.childNodes),R=0;R<M.length;R+=1){var Z=M[R];if(ti(Z))return Z.textContent}return null}else if(D(p)==="img"||D(p)==="area"){var q=w(p,"alt");if(q!==null)return q}else if(Br(p)){var re=w(p,"label");if(re!==null)return re}if(Be(p)&&(p.type==="button"||p.type==="submit"||p.type==="reset")){var Ee=w(p,"value");if(Ee!==null)return Ee;if(p.type==="submit")return"Submit";if(p.type==="reset")return"Reset"}var he=pi(p);if(he!==null&&he.length!==0)return n.add(p),K(he).map(function(ge){return y(ge,{isEmbeddedInLabel:!0,isReferenced:!1,recursion:!0})}).filter(function(ge){return ge.length>0}).join(" ");if(Be(p)&&p.type==="image"){var Ke=w(p,"alt");if(Ke!==null)return Ke;var Te=w(p,"title");return Te!==null?Te:"Submit Query"}if(ne(p,["button"])){var Je=b(p,{isEmbeddedInLabel:!1});if(Je!=="")return Je}return null}function y(p,k){if(n.has(p))return"";if(!a&&ri(p,h)&&!k.isReferenced)return n.add(p),"";var x=A(p)?p.getAttributeNode("aria-labelledby"):null,P=x!==null&&!n.has(x)?ht(p,"aria-labelledby"):[];if(s==="name"&&!k.isReferenced&&P.length>0)return n.add(x),P.map(function(q){return y(q,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!0,recursion:!1})}).join(" ");var G=k.recursion&&ii(p)&&s==="name";if(!G){var H=(A(p)&&p.getAttribute("aria-label")||"").trim();if(H!==""&&s==="name")return n.add(p),H;if(!si(p)){var j=E(p);if(j!==null)return n.add(p),j}}if(ne(p,["menu"]))return n.add(p),"";if(G||k.isEmbeddedInLabel||k.isReferenced){if(ne(p,["combobox","listbox"])){n.add(p);var M=oi(p);return M.length===0?Be(p)?p.value:"":K(M).map(function(q){return y(q,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!1,recursion:!0})}).join(" ")}if(an(p,"range"))return n.add(p),p.hasAttribute("aria-valuetext")?p.getAttribute("aria-valuetext"):p.hasAttribute("aria-valuenow")?p.getAttribute("aria-valuenow"):p.getAttribute("value")||"";if(ne(p,["textbox"]))return n.add(p),ui(p)}if(li(p)||A(p)&&k.isReferenced||ai(p)||ci()){var R=b(p,{isEmbeddedInLabel:k.isEmbeddedInLabel});if(R!=="")return n.add(p),R}if(p.nodeType===p.TEXT_NODE)return n.add(p),p.textContent||"";if(k.recursion)return n.add(p),b(p,{isEmbeddedInLabel:k.isEmbeddedInLabel});var Z=v(p);return Z!==null?(n.add(p),Z):(n.add(p),"")}return ni(y(e,{isEmbeddedInLabel:!1,isReferenced:s==="description",recursion:!1}))}function gi(e){return ne(e,["caption","code","deletion","emphasis","generic","insertion","none","paragraph","presentation","strong","subscript","superscript"])}function mi(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return gi(e)?"":hi(e,t)}const bi=new Set(["a","an","and","are","be","can","do","does","for","from","how","i","in","is","it","me","my","of","on","or","the","this","to","up","what","where","with","you","your"]),_i=new Set(["ok","go","close","open","menu","more","link","button","submit","click here","here","next","previous","back","toggle","dismiss","x"]),yi={dialog:3,sidebar:2,header:2,navigation:2,main:1},vi={theme:["dark","light","appearance","mode"],dark:["theme","appearance","night"],username:["name","handle","profile","account","display"],profile:["account","username","settings"],account:["profile","user","settings"],password:["security","credentials"],billing:["payment","invoice","plan"],key:["keys","token","api"]};function pn(e){return e.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>1&&!bi.has(t)).map(fn)}function fn(e){return e.length>4&&e.endsWith("ies")?`${e.slice(0,-3)}y`:e.length>3&&e.endsWith("es")&&!e.endsWith("ses")?e.slice(0,-2):e.length>3&&e.endsWith("s")&&!e.endsWith("ss")?e.slice(0,-1):e.length>5&&e.endsWith("ing")?e.slice(0,-3):e}function wi(e){const t=new Set(pn(e));for(const n of[...t])for(const r of vi[n]??[])t.add(fn(r));return t}function xi(e,t){let n=e.visible?4:0;n+=yi[e.landmark??""]??0,e.disabled&&(n-=2);const r=pn([e.name,e.text??"",e.href??""].join(" "));r.length===0&&(n-=3);let i=0;for(const s of new Set(r))t.has(s)&&(i+=1);n+=i*6;const o=e.name.trim().toLowerCase();return o?_i.has(o)&&(n-=2):n-=4,n}function ki(e,t,n){const r=wi(t);return e.map((i,o)=>({candidate:i,index:o,score:xi(i,r)})).sort((i,o)=>o.score-i.score||i.index-o.index).slice(0,n).sort((i,o)=>i.index-o.index).map(i=>i.candidate)}const Si=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","SVG","IFRAME","CANVAS"]),Ei=2e3;function Ti(e){if(e.hasAttribute("hidden")||e.getAttribute("aria-hidden")==="true")return!0;const t=e.ownerDocument.defaultView;if(!t)return!1;try{const n=t.getComputedStyle(e);return n.display==="none"||n.visibility==="hidden"}catch{return!1}}function Ai(e,t=null,n=Ei){if(!e)return"";const r=[];let i=0;const o=s=>{if(i>=n)return;if(s.nodeType===3){const d=(s.nodeValue??"").replace(/\s+/g," ").trim();if(!d)return;r.push(d),i+=d.length+1;return}if(s.nodeType!==1)return;const l=s;if(!(l===t||Si.has(l.tagName)||Ti(l)))for(const d of Array.from(l.childNodes))o(d)};return o(e),r.join(" ").slice(0,n)}const hn=["button","a[href]",'input:not([type="hidden"])',"select","textarea","summary",'[role="button"]','[role="link"]','[role="tab"]','[role="menuitem"]','[role="menuitemcheckbox"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="combobox"]','[role="option"]','[tabindex]:not([tabindex="-1"])','[contenteditable=""]','[contenteditable="true"]'].join(","),Li=150;function Ve(e={}){const t=e.root??document,n=e.question??"",r=e.limit??Li,i=[],o=new Set;Ci(t.body??t.documentElement,i,o,e.exclude??null);const s=ki(i,n,r),l=new Map,d=s.map((c,g)=>{const f=`a${g+1}`;l.set(f,c.element);const a={id:f,role:c.role,name:c.name,visible:c.visible};return c.text&&c.text!==c.name&&(a.text=c.text),c.landmark&&(a.landmark=c.landmark),c.href&&(a.href=c.href),c.disabled&&(a.disabled=!0),c.state&&(a.state=c.state),a});return{page:{url:t.defaultView?.location?.href??"",title:t.title??"",affordances:d,text:Ai(t.body??t.documentElement,e.exclude??null)},lookup:l}}function Ci(e,t,n,r){if(!e)return;const i=[e];for(;i.length;){const o=i.shift();if(r&&(o===r||r.contains(o)))continue;o!==e&&!n.has(o)&&Ii(o,hn)&&(n.add(o),t.push(gn(o)));for(const l of Array.from(o.children))i.push(l);const s=o.shadowRoot;if(s&&s.mode==="open")for(const l of Array.from(s.children))i.push(l)}}function Ii(e,t){try{return e.matches(t)}catch{return!1}}function Ni(e){const t=gn(e),n={id:"",role:t.role,name:t.name,visible:t.visible};return t.text&&t.text!==t.name&&(n.text=t.text),t.landmark&&(n.landmark=t.landmark),t.href&&(n.href=t.href),t.disabled&&(n.disabled=!0),t.state&&(n.state=t.state),n}function gn(e){const t=Ri(e),n=(e.textContent??"").replace(/\s+/g," ").trim().slice(0,120),r=e instanceof HTMLAnchorElement?e.getAttribute("href")??void 0:void 0;return{element:e,role:$i(e),name:t,text:n||void 0,landmark:Di(e),href:r,visible:Ui(e),disabled:Hi(e),state:Mi(e)}}function Mi(e){const t=[];return(e.getAttribute("aria-selected")==="true"||e.getAttribute("aria-current")==="page")&&t.push("selected"),e.getAttribute("aria-expanded")==="true"&&t.push("expanded"),(e.getAttribute("aria-checked")??(Oi(e)?"true":null))==="true"&&t.push("checked"),t.length?t.join(", "):void 0}function Oi(e){return e instanceof HTMLInputElement&&(e.type==="checkbox"||e.type==="radio")?e.checked:!1}function Ri(e){try{const n=mi(e).replace(/\s+/g," ").trim();if(n)return n}catch{}return(e.getAttribute("aria-label")??e.getAttribute("title")??e.getAttribute("placeholder")??e.getAttribute("value")??e.textContent??"").replace(/\s+/g," ").trim().slice(0,120)}const Pi={checkbox:"checkbox",radio:"radio",range:"slider",button:"button",submit:"button",reset:"button",search:"searchbox",email:"textbox",tel:"textbox",url:"textbox",number:"spinbutton",password:"textbox",text:"textbox"};function $i(e){const t=e.getAttribute("role");if(t)return t.trim().split(/\s+/)[0];switch(e.tagName.toLowerCase()){case"a":return e.hasAttribute("href")?"link":"generic";case"button":return"button";case"select":return"combobox";case"textarea":return"textbox";case"summary":return"button";case"input":{const r=(e.getAttribute("type")??"text").toLowerCase();return Pi[r]??"textbox"}default:return e.getAttribute("contenteditable")!==null?"textbox":"button"}}const mn={nav:"sidebar",header:"header",main:"main",aside:"sidebar",footer:"footer",dialog:"dialog",form:"form"},bn={navigation:"sidebar",banner:"header",main:"main",complementary:"sidebar",contentinfo:"footer",dialog:"dialog",alertdialog:"dialog",menu:"menu",form:"form",search:"search"};function Di(e){let t=e;for(;t&&t!==t.ownerDocument?.body;){const n=t.getAttribute("role");if(n&&bn[n])return bn[n];const r=t.tagName.toLowerCase();if(mn[r])return mn[r];const i=t.getAttribute("aria-label");if(i&&t.hasAttribute("data-region"))return i.toLowerCase();t=t.parentElement??t.getRootNode().host??null}}function Hi(e){return e.getAttribute("aria-disabled")==="true"?!0:"disabled"in e&&!!e.disabled}function Ui(e){if(e.closest('[aria-hidden="true"],[hidden],[inert]'))return!1;const t=e.ownerDocument?.defaultView,n=t?.getComputedStyle(e);if(n&&(n.display==="none"||n.visibility==="hidden"||n.visibility==="collapse"||n.opacity==="0"))return!1;const r=e.getBoundingClientRect();if(!(typeof t?.innerWidth=="number"&&r.width+r.height>0))return Gi(e);if(r.width===0||r.height===0)return!1;const o=t?.innerWidth??0,s=t?.innerHeight??0;return r.bottom<=0||r.right<=0||r.top>=s||r.left>=o?!1:qi(e,r,o,s)}function Gi(e){let t=e;const n=e.ownerDocument?.defaultView;for(;t;){const r=n?.getComputedStyle(t);if(r&&(r.display==="none"||r.visibility==="hidden"))return!1;t=t.parentElement}return!0}function qi(e,t,n,r){const i=e.ownerDocument;if(!i||typeof i.elementFromPoint!="function")return!0;const o=Math.min(Math.max(t.left+t.width/2,1),n-1),s=Math.min(Math.max(t.top+t.height/2,1),r-1),l=Fi(i,o,s);return l?l===e||e.contains(l)||l.contains(e):!1}function Fi(e,t,n){let r=e.elementFromPoint(t,n);for(;r;){const i=r.shadowRoot;if(!i)return r;const o=i.elementFromPoint?.(t,n);if(!o||o===r)return r;r=o}return r}const gt="lantern:press",_n="lantern:seen",ji=1e4,zi=400,Bi=8e3,Vi=150;function mt(e){const t=e.page.affordances.map(n=>je(we(n,e.page.url)));return`${e.page.title}
${t.sort().join(`
`)}`}function yn(e){try{return sessionStorage.getItem(e)}catch{return null}}function bt(e,t){try{t===null?sessionStorage.removeItem(e):sessionStorage.setItem(e,t)}catch{}}function Wi(){const e=yn(gt);if(!e)return null;try{const t=JSON.parse(e);return typeof t.fromUrl!="string"||typeof t.at!="number"?null:t}catch{return null}}function Yi(){const e=yn(_n);if(!e)return new Set;try{const t=JSON.parse(e);return new Set(Array.isArray(t)?t.filter(n=>typeof n=="string"):[])}catch{return new Set}}function Ki(e,t){const n=Yi();let r=!1;const i=f=>{n.add(f),bt(_n,JSON.stringify([...n]))},o=async f=>{const a=Date.now()+Bi;for(;;){if(await Qt(zi,2e3,document.body),r)return null;const h=Ve({exclude:t});if(f===null||mt(h)!==f)return h;if(Date.now()>a)return null;await new Promise(b=>setTimeout(b,Vi))}},s=async(f,a)=>{const h=await o(a);if(!h)return;const{page:b}=h,w=ve(b.url),v=!n.has(`page|${w}`);let E;if(f&&ve(f.fromUrl)!==w){const y=`move|${ve(f.fromUrl)}|${f.control.role}|${f.control.name.toLowerCase()}|${w}`;n.has(y)||(E=f,i(y))}!v&&!E||(v&&i(`page|${w}`),await e.observe(E?{page:b,transition:E}:{page:b}))},l=f=>{const a=f.target instanceof Element?f.target:null;if(!a||t&&t.contains(a)||f.type==="keydown"&&f.key!=="Enter")return;const h=a.closest(hn);if(!h)return;const b=Ni(h);if(!b.name.trim())return;const w={fromUrl:location.href,fromTitle:document.title,control:we(b,location.href),at:Date.now()};bt(gt,JSON.stringify(w))};document.addEventListener("pointerdown",l,!0),document.addEventListener("keydown",l,!0);const d=()=>{const f=Wi();if(f&&(bt(gt,null),!(Date.now()-f.at>ji)&&f.fromUrl!==location.href))return{fromUrl:f.fromUrl,fromTitle:f.fromTitle,control:f.control}};let c=mt(Ve({exclude:t}));const g=Zt(()=>{const f=c;s(d(),f).catch(()=>{}).finally(()=>{r||(c=mt(Ve({exclude:t})))})});return s(d(),null).catch(()=>{}),{dispose:()=>{r=!0,document.removeEventListener("pointerdown",l,!0),document.removeEventListener("keydown",l,!0),g()}}}class Ji{constructor(t,n=()=>{}){this.onStateChange=t,this.onFinished=n,this.audio=null,this.abort=null,this.objectUrl=null,this.token=0}get speaking(){return!!(this.audio&&!this.audio.paused&&!this.audio.ended)}async play(t){this.stop();const n=this.token+=1,r=()=>{n===this.token&&(this.token+=1,this.onFinished())},i=new AbortController;this.abort=i;try{const o=await t(i.signal);if(!o.body){r();return}const s=new Audio;this.audio=s,s.addEventListener("ended",()=>{this.onStateChange(!1),r()}),s.addEventListener("error",()=>r()),s.addEventListener("pause",()=>this.onStateChange(this.speaking)),Xi()?await this.playStreaming(s,o.body,i.signal,r):await this.playBuffered(s,o,r),this.onStateChange(!0)}catch(o){o?.name!=="AbortError"&&(this.onStateChange(!1),r())}}stop(){this.token+=1,this.abort?.abort(),this.abort=null,this.audio&&(this.audio.pause(),this.audio.src="",this.audio=null),this.objectUrl&&(URL.revokeObjectURL(this.objectUrl),this.objectUrl=null),this.onStateChange(!1)}async playStreaming(t,n,r,i){const o=new MediaSource;this.objectUrl=URL.createObjectURL(o),t.src=this.objectUrl,await new Promise(c=>o.addEventListener("sourceopen",()=>c(),{once:!0}));const s=o.addSourceBuffer("audio/mpeg"),l=n.getReader();let d=!1;for(;;){const{done:c,value:g}=await l.read();if(c||r.aborted)break;await Zi(s,g),d||(d=!0,t.play().catch(i))}o.readyState==="open"&&o.endOfStream(),d||t.play().catch(i)}async playBuffered(t,n,r){const i=await n.blob();this.objectUrl=URL.createObjectURL(i),t.src=this.objectUrl,await t.play().catch(r)}}function Xi(){return typeof MediaSource<"u"&&typeof MediaSource.isTypeSupported=="function"&&MediaSource.isTypeSupported("audio/mpeg")}function Zi(e,t){return new Promise((n,r)=>{const i=()=>{e.removeEventListener("updateend",i),n()};e.addEventListener("updateend",i),e.addEventListener("error",r,{once:!0});try{e.appendBuffer(t)}catch(o){r(o)}})}class fe{constructor(){this.recorder=null,this.chunks=[],this.stream=null,this.audio=null,this.silenceTimer=null}static get supported(){return typeof MediaRecorder<"u"&&typeof navigator<"u"&&!!navigator.mediaDevices?.getUserMedia}static async alreadyAllowed(){try{return(await navigator.permissions.query({name:"microphone"})).state==="granted"}catch{return!1}}get recording(){return this.recorder?.state==="recording"}async start(t){this.recording||(this.stream=await navigator.mediaDevices.getUserMedia({audio:!0}),this.chunks=[],this.recorder=new MediaRecorder(this.stream,Qi()),this.recorder.addEventListener("dataavailable",n=>{n.data.size>0&&this.chunks.push(n.data)}),this.recorder.start(250),t&&this.watchForSilence(t))}watchForSilence(t){if(!this.stream)return;const n=window.AudioContext??window.webkitAudioContext;if(!n)return;this.audio=new n;const r=this.audio.createMediaStreamSource(this.stream),i=this.audio.createAnalyser();i.fftSize=1024,r.connect(i);const o=new Uint8Array(i.frequencyBinCount);let s=!1,l=0;const d=()=>{if(!this.recording)return;i.getByteTimeDomainData(o);let c=0;for(const a of o)c=Math.max(c,Math.abs(a-128));const g=c>6,f=Date.now();if(g)s=!0,l=0;else if(s){if(l===0)l=f;else if(f-l>2600){t();return}}this.silenceTimer=window.setTimeout(d,120)};d()}async stop(){const t=this.recorder;if(!t||t.state==="inactive")return this.release(),null;const n=await new Promise(r=>{t.addEventListener("stop",()=>r(new Blob(this.chunks,{type:t.mimeType||"audio/webm"})),{once:!0}),t.stop()});return this.release(),n.size>0?n:null}cancel(){this.recorder&&this.recorder.state!=="inactive"&&this.recorder.stop(),this.release()}release(){this.silenceTimer!==null&&window.clearTimeout(this.silenceTimer),this.silenceTimer=null,this.audio?.close().catch(()=>{}),this.audio=null,this.stream?.getTracks().forEach(t=>t.stop()),this.stream=null,this.recorder=null,this.chunks=[]}}function Qi(){for(const e of["audio/webm;codecs=opus","audio/webm","audio/mp4"])if(MediaRecorder.isTypeSupported?.(e))return{mimeType:e};return{}}const vn={active:!1,muted:!1,phase:"listening"};function eo(e,t){switch(t.type){case"start":return e.active?e:{active:!0,muted:!1,phase:"listening"};case"end":return vn}if(!e.active)return e;switch(t.type){case"toggleMute":return{...e,muted:!e.muted};case"heard":return e.phase==="listening"?{...e,phase:"thinking"}:e;case"answered":return e.phase==="speaking"?e:{...e,phase:"speaking"};case"spoke":return e.phase==="speaking"?{...e,phase:"listening"}:e;case"unheard":return e.phase==="listening"?e:{...e,phase:"listening"};default:return e}}function to(e){return e.active?e.phase==="listening"?e.muted?"Muted":"Listening":e.phase==="thinking"?"Thinking":"Speaking":""}function no(e){return e.active&&!e.muted&&e.phase==="listening"}const B={viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":1.8,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"},ro=()=>u("svg",{...B,children:u("path",{d:"M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"})}),wn=()=>u("svg",{...B,children:u("path",{d:"m6 6 12 12M18 6 6 18"})}),io=()=>u("svg",{...B,children:u("path",{d:"M4.5 12h13M12 5.5 18.5 12 12 18.5"})}),xn=()=>u("svg",{...B,children:[u("rect",{x:"9",y:"3",width:"6",height:"11",rx:"3"}),u("path",{d:"M5 11a7 7 0 0 0 14 0M12 18v3"})]}),oo=()=>u("svg",{...B,children:[u("path",{d:"M15 5a3 3 0 0 0-6 0v4M9 12v2a3 3 0 0 0 4.6 2.5"}),u("path",{d:"M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.6 2.8M12 18v3"}),u("path",{d:"m4 3 16 18"})]}),so=()=>u("svg",{...B,children:[u("path",{d:"M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"}),u("path",{d:"M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"})]}),ao=()=>u("svg",{...B,children:u("path",{d:"M6.5 3.5h3l1.5 4-2 1.3a12 12 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"})}),lo=()=>u("svg",{...B,children:[u("path",{d:"M8.2 4.2h2.4l1.2 3.4-1.7 1.1a11 11 0 0 0 4.6 4.6l1.1-1.7 3.4 1.2v2.4a1.8 1.8 0 0 1-2 1.8A14.6 14.6 0 0 1 6.4 6.2a1.8 1.8 0 0 1 1.8-2Z"}),u("path",{d:"m3.5 3.5 17 17"})]}),co=()=>u("svg",{...B,children:[u("rect",{x:"9",y:"9",width:"11",height:"11",rx:"2.5"}),u("path",{d:"M15 5.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15"})]}),uo=()=>u("svg",{...B,children:u("path",{d:"m5 12.5 4.5 4.5L19 7"})}),po=()=>u("svg",{...B,children:[u("path",{d:"M7 10.5 11 3a2.2 2.2 0 0 1 2.2 2.7L12.5 9h4.7A2 2 0 0 1 19 11.4l-1.3 6A2 2 0 0 1 15.7 19H7"}),u("rect",{x:"3",y:"10",width:"4",height:"9",rx:"1.2"})]}),fo=()=>u("svg",{...B,children:[u("path",{d:"M7 13.5 11 21a2.2 2.2 0 0 0 2.2-2.7L12.5 15h4.7A2 2 0 0 0 19 12.6l-1.3-6A2 2 0 0 0 15.7 5H7"}),u("rect",{x:"3",y:"5",width:"4",height:"9",rx:"1.2"})]});function ho({state:e,transcript:t,onToggleMute:n,onEnd:r}){const i=to(e);return u("div",{class:"pl-call",role:"group","aria-label":"Call controls",children:[u("div",{class:"pl-call__state",children:[u("span",{class:`pl-call__pulse pl-call__pulse--${e.muted?"muted":e.phase}`,"aria-hidden":"true"}),u("span",{class:"pl-call__body",children:[u("span",{class:"pl-call__label",role:"status","aria-live":"polite",children:i}),t&&u("span",{class:"pl-call__transcript",children:t})]})]}),u("button",{type:"button",class:"pl-icon-btn","aria-pressed":e.muted,"aria-label":e.muted?"Unmute the microphone":"Mute the microphone",title:e.muted?"Unmute":"Mute",onClick:n,children:e.muted?u(oo,{}):u(xn,{})}),u("button",{type:"button",class:"pl-btn pl-btn--end",onClick:r,children:[u(lo,{}),u("span",{children:"End call"})]})]})}function go(e){const t=O(null),[n,r]=C(0);$(()=>{t.current?.focus()},[e.focusToken]),$(()=>{const o=t.current;o&&(o.style.height="auto",o.style.height=`${Math.min(o.scrollHeight,96)}px`,o.style.overflowY=o.scrollHeight>96?"auto":"hidden",r(o.scrollHeight))},[e.value]);const i=e.recording?"Stop and send":"Dictate a question";return u("form",{class:"pl-composer",onSubmit:o=>{o.preventDefault(),e.onSubmit()},children:[u("div",{class:"pl-composer__field",children:[u("textarea",{ref:t,rows:1,"data-height":n,value:e.value,placeholder:e.transcribing?"Transcribing...":e.recording?"Listening...":"Ask a question","aria-label":"Ask a question",disabled:e.transcribing,onInput:o=>e.onInput(o.currentTarget.value),onKeyDown:o=>{o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),e.onSubmit())}}),e.voiceSupported&&u("button",{type:"button",class:"pl-icon-btn","aria-pressed":e.recording,"aria-label":i,title:i,onClick:()=>e.onToggleRecording(),children:u(xn,{})})]}),u("button",{type:"submit",class:"pl-send","aria-label":"Send",disabled:e.busy||e.value.trim().length===0,children:u(io,{})})]})}function mo({open:e,unread:t,onClick:n}){return u("button",{type:"button",class:"pl-launcher","aria-label":e?"Close support":t?"Open support, one new answer":"Open support","aria-expanded":e,onClick:n,children:[e?u(wn,{}):u(ro,{}),!e&&t&&u("span",{class:"pl-launcher__dot","aria-hidden":"true"})]})}function kn({text:e,rating:t,canRate:n,onRate:r}){const[i,o]=C(!1),s=async()=>{try{await navigator.clipboard.writeText(e),o(!0),setTimeout(()=>o(!1),1600)}catch{}};return u("div",{class:"pl-answer-actions",children:[u("button",{type:"button",class:"pl-mini",onClick:()=>void s(),"aria-label":i?"Copied":"Copy the answer",children:[i?u(uo,{}):u(co,{}),u("span",{children:i?"Copied":"Copy"})]}),u("span",{class:"pl-answer-actions__spacer"}),t?u("span",{class:"pl-answer-actions__thanks",children:"Thank you"}):u(se,{children:[u("button",{type:"button",class:"pl-mini pl-mini--icon",disabled:!n,"aria-label":"This answer helped",title:"This answer helped",onClick:()=>r("up"),children:u(po,{})}),u("button",{type:"button",class:"pl-mini pl-mini--icon",disabled:!n,"aria-label":"This answer did not help",title:"This answer did not help",onClick:()=>r("down"),children:u(fo,{})})]})]})}const bo=600,Sn=40;function En(){return typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches}function _o(e){return e.match(/\S+\s*/g)??[]}function Tn(e){const[t,n]=C(()=>En()?e:""),r=O(!1);return $(()=>{if(r.current||En()||!e){n(e);return}r.current=!0;const i=_o(e),o=Math.max(1,Math.ceil(i.length/Math.max(1,bo/Sn)));let s=0;const l=setInterval(()=>{if(s+=o,s>=i.length){clearInterval(l),n(e);return}n(i.slice(0,s).join(""))},Sn);return()=>clearInterval(l)},[e]),t}const yo="Text me when a change for this is drafted",vo="You get one text, and only if the team drafts a change. Your number is stored encrypted and deleted after that text. Message rates can apply.",wo="Mobile number with country code",xo="+1 415 555 0123",ko="Enter your number with the country code, for example +1 415 555 0123.",An={subscribed:"You will get one text when a change for this is drafted.",not_needed:"A change for this was already drafted, so there is no text to send. This report did not save your number.",unavailable:"The text could not be set up, and this report did not save your number. The report itself was sent."};function So(e,t){if(!e)return{ok:!0};const n=cr(t);return n?{ok:!0,phone:n}:{ok:!1}}const Eo=new Set(["queued","filing","filed","updated","inspecting","drafting"]);function To(e,t){return e!=="subscribed"||Eo.has(t)}const Ao={no_repository:"The team has not connected a repository yet, so I cannot report this.",failed:"The report could not be sent. Nothing was lost, so try again in a moment."};function Lo({text:e,request:t,escalation:n,reporting:r,blocked:i,noted:o,textNotice:s,notice:l,elapsedSeconds:d,rating:c,canRate:g,onReport:f,onRate:a}){const h=Tn(e),b=h===e;return u("div",{class:"pl-card",children:[u("p",{children:h}),b&&!n&&!i&&t&&u(Co,{request:t,reporting:r,textNotice:s,onReport:f}),b&&!n&&i&&u("p",{class:"pl-card__note",children:Ao[i]}),b&&!n&&!i&&o&&u("p",{class:"pl-card__note",children:"I have noted this for the team."}),n&&u(No,{escalation:n,elapsedSeconds:d}),n&&l&&To(l,n.status)&&u("p",{class:"pl-card__note",children:An[l]}),b&&u(kn,{text:e,rating:c,canRate:g,onRate:a})]})}function Co({request:e,reporting:t,textNotice:n,onReport:r}){const[i,o]=C(!1),[s,l]=C(""),[d,c]=C(!1),g=O(null),f=O(null),a=er();return $(()=>{i&&f.current?.scrollIntoView?.({block:"nearest"})},[i,d]),u("form",{class:"pl-report",ref:f,noValidate:!0,onSubmit:b=>{if(b.preventDefault(),t)return;const w=So(!!n&&i,s);if(!w.ok){c(!0),g.current?.focus();return}r(w.phone)},children:[n&&u("div",{class:"pl-notify",children:[u("label",{class:"pl-check",children:[u("input",{type:"checkbox",checked:i,disabled:t,onChange:b=>{o(b.currentTarget.checked),c(!1)}}),u("span",{children:yo})]}),i&&u(se,{children:[u("input",{ref:g,class:"pl-input",type:"tel",inputMode:"tel",autoComplete:"tel",value:s,placeholder:xo,"aria-label":wo,"aria-describedby":d?`${a}-error ${a}-hint`:`${a}-hint`,"aria-invalid":d,disabled:t,onInput:b=>{l(b.currentTarget.value),c(!1)}}),d&&u("p",{class:"pl-notify__error",id:`${a}-error`,role:"alert",children:ko}),u("p",{class:"pl-notify__hint",id:`${a}-hint`,children:vo})]})]}),u("div",{class:"pl-card__actions",children:[u("button",{type:"submit",class:"pl-btn pl-btn--accent",disabled:t,children:t?"Reporting":"Report to developers"}),u("span",{class:"pl-card__label",children:e.title})]})]})}const Io=[{key:"filed",label:"Your request was sent to the team",statuses:["filing","filed","updated","inspecting","drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"drafted",label:"Someone is working on it",statuses:["drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"pr",label:"A change is ready for review",statuses:["pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"approval",label:"Waiting on a final check",statuses:["awaiting_approval","approved","merging","deploying","shipped"]},{key:"shipped",label:"Done, it is live",statuses:["shipped"]}],Ln=["queued","filing","filed","updated","inspecting","drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"];function No({escalation:e,elapsedSeconds:t}){const n=e.status,r=Ln.indexOf(n);return n==="failed"||n==="rejected"?u("p",{class:"pl-timeline__note",children:n==="rejected"?"A developer decided not to build this for now.":"The report could not be completed. The team has the details."}):u(se,{children:[u("span",{class:"pl-card__label",children:"Progress"}),u("ul",{class:"pl-timeline",children:Io.map(i=>{const o=i.statuses.includes(n),s=Ln.indexOf(i.statuses[0]),l=o?r>s?"done":"current":"pending";return u("li",{"data-state":l,children:[u("span",{class:"pl-timeline__mark"}),u("span",{class:"pl-timeline__body",children:[u("span",{children:Mo(i,e)}),l==="current"&&t>10&&u("span",{class:"pl-timeline__note",children:[t,"s so far"]})]})]},i.key)})})]})}function Mo(e,t){return e.key==="filed"&&t.issueUrl?u("a",{class:"pl-link",href:t.issueUrl,target:"_blank",rel:"noreferrer noopener",children:"See your request on GitHub"}):e.key==="pr"&&t.prUrl?u("a",{class:"pl-link",href:t.prUrl,target:"_blank",rel:"noreferrer noopener",children:"See the change on GitHub"}):e.key==="shipped"&&t.deploymentUrl?u("a",{class:"pl-link",href:t.deploymentUrl,target:"_blank",rel:"noreferrer noopener",children:"It is live now, reload the page to use it"}):e.label}function Oo({text:e,steps:t,plan:n,sources:r,guiding:i,rating:o,canRate:s,onShowMe:l,onRate:d}){const c=Tn(e),g=c===e,f=n?.total??t?.length??0;return u("div",{class:"pl-card",children:[u("p",{children:c}),g&&t&&t.length>0&&u("div",{class:"pl-card__actions",children:[u("button",{type:"button",class:"pl-btn pl-btn--accent",onClick:l,disabled:i,children:i?"Showing you":"Show me"}),u("span",{class:"pl-card__label",children:[f," step",f===1?"":"s"]})]}),g&&r&&r.length>0&&u("p",{class:"pl-card__note",children:["From:"," ",r.map((a,h)=>u("span",{children:[h>0?", ":"",a.url?u("a",{class:"pl-link",href:a.url,target:"_blank",rel:"noreferrer",children:a.title}):a.title]},`${a.title}-${h}`))]}),g&&u(kn,{text:e,rating:o,canRate:s,onRate:d})]})}const ke=["reading","docs","page","code","deciding","writing"],Ro={reading:"Reading your question",docs:"Checking the documentation",page:"Looking at this page",code:"Checking known product capabilities",deciding:"Deciding",writing:"Writing the answer"},We="reading",Po=700,$o=8e3,Do="Still working";function Ho(e){switch(e.type){case"conversation":return"reading";case"understanding":return e.intent==="chat"||e.intent==="page"?"writing":"docs";case"probe":return e.status==="running"?"docs":e.probe==="docs"?"page":e.probe==="interface"?"code":"deciding";case"verdict":return"writing";default:return null}}function Uo(e,t){const n=Ho(t);return n&&ke.indexOf(n)>ke.indexOf(e)?n:e}function Go(e,t){const n=ke.indexOf(e);return ke.indexOf(t)>n?ke[n+1]:e}function qo(e,t){const n=Ro[e];return t>=$o?`${n}. ${Do}`:n}function Fo({stage:e,elapsedMs:t}){return u("div",{class:"pl-thinking",role:"status","aria-live":"polite",children:[u("span",{class:"pl-typing","aria-hidden":"true",children:[u("span",{}),u("span",{}),u("span",{})]}),u("span",{class:"pl-thinking__line",children:qo(e,t)})]})}const Cn=40;function jo({turns:e,workingTurnId:t,stage:n,workingMs:r,guidingTurnId:i,elapsedSeconds:o,scroll:s,onShowMe:l,onReport:d,onRate:c}){const g=O(null),f=O(!0),a=O(!1);return Qn(()=>{const b=g.current;!b||a.current||(a.current=!0,!(s.current<0)&&(b.scrollTop=s.current,f.current=b.scrollHeight-b.scrollTop-b.clientHeight<Cn))},[s]),$(()=>{const b=g.current;!b||!f.current||(b.scrollTop=b.scrollHeight,s.current=b.scrollTop)},[e,t,n,s]),u("div",{class:"pl-messages",ref:g,onScroll:()=>{const b=g.current;b&&(s.current=b.scrollTop,f.current=b.scrollHeight-b.scrollTop-b.clientHeight<Cn)},children:[e.length===0&&u("div",{class:"pl-empty",children:[u("h3",{children:"How can we help?"}),u("p",{children:"Ask a question and we will point at the right control on this page."})]}),e.map(b=>u(zo,{turn:b,working:t===b.id,stage:n,workingMs:r,guiding:i===b.id,elapsedSeconds:o,onShowMe:l,onReport:d,onRate:c},b.id))]})}function zo({turn:e,working:t,stage:n,workingMs:r,guiding:i,elapsedSeconds:o,onShowMe:s,onReport:l,onRate:d}){const c=e.answer?.escalation,g=!!e.messageId,f=a=>d(e,a);return u(se,{children:[u("div",{class:"pl-msg pl-msg--user",children:u("p",{children:e.question})}),e.memory&&e.memory.length>0&&u("p",{class:"pl-recall",children:"Welcome back."}),t&&u(Fo,{stage:n,elapsedMs:r}),e.error&&u("div",{class:"pl-msg pl-msg--agent",children:u("p",{children:e.error})}),e.answer&&c&&(c.offered===!0||c.reason)&&u(Lo,{text:e.answer.text,request:c.offered===!0?c.request:void 0,escalation:e.escalation,reporting:e.reporting,blocked:e.reportBlocked??(c.offered===!0?void 0:c.reason),noted:e.answer.noted,textNotice:c.offered===!0&&c.textNotice===!0,notice:e.textNotice,elapsedSeconds:o,rating:e.rating,canRate:g,onReport:a=>l(e,a),onRate:f}),e.answer&&c?.offered!==!0&&!c?.reason&&u(Oo,{text:e.answer.text,steps:e.answer.steps,plan:e.answer.plan,sources:e.answer.sources,guiding:i,rating:e.rating,canRate:g,onShowMe:()=>s(e),onRate:f})]})}const Bo='button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';function Vo({title:e,subtitle:t,speaking:n,onCall:r,onStopSpeaking:i,onClose:o,onEscape:s,children:l}){const d=O(null);return $(()=>{const c=d.current;if(!c)return;const g=f=>{if(f.key==="Escape"){f.stopPropagation(),s();return}if(f.key!=="Tab")return;const a=Array.from(c.querySelectorAll(Bo)).filter(v=>v.offsetParent!==null||v===c.ownerDocument.activeElement);if(a.length===0)return;const h=a[0],b=a[a.length-1],w=c.getRootNode().activeElement;!f.shiftKey&&w===b?(f.preventDefault(),h.focus()):f.shiftKey&&w===h&&(f.preventDefault(),b.focus())};return c.addEventListener("keydown",g),()=>c.removeEventListener("keydown",g)},[s]),u("div",{class:"pl-panel",role:"dialog","aria-label":e,ref:d,children:[u("header",{class:"pl-header",children:[u("div",{class:"pl-header__text",children:[u("p",{class:"pl-header__title",children:e}),u("p",{class:"pl-header__sub",children:t})]}),u("span",{class:"pl-header__spacer"}),r&&u("button",{type:"button",class:"pl-btn pl-btn--call",onClick:r,children:[u(ao,{}),u("span",{children:"Start a call"})]}),n&&u("button",{type:"button",class:"pl-icon-btn","aria-label":"Stop speaking",onClick:i,children:u(so,{})}),u("button",{type:"button",class:"pl-icon-btn","aria-label":"Close support",onClick:o,children:u(wn,{})})]}),l]})}function Wo(e,t){return{id:e,question:t,probes:{docs:{status:"pending"},interface:{status:"pending"},repository:{status:"pending"}}}}const _t="lantern:call";function Ye(e){try{e?sessionStorage.setItem(_t,"1"):sessionStorage.removeItem(_t)}catch{}}function Yo(){try{return sessionStorage.getItem(_t)==="1"}catch{return!1}}const In=new Set(["shipped","failed","rejected"]),Ko=["queued","filing","inspecting","drafting","pr_open","awaiting_approval","approved","rejected","merging","deploying","shipped","failed"];function Jo(e){return Ko.includes(e)?e:"queued"}function Xo({client:e,shadow:t,host:n,position:r,register:i}){const[o,s]=C(!1),[l,d]=C([]),[c,g]=C(""),[f,a]=C(!1),[h,b]=C(null),[w,v]=C(""),[E,y]=C(!1),[p,k]=C(!1),[x,P]=C(!1),[G,H]=C(0),[j,M]=C(!1),[R,Z]=C(0),[q,re]=C(null),[Ee,he]=C(We),[Ke,Te]=C(We),[Je,ge]=C(0),[ie,V]=Wt(eo,vn),[vs,yt]=C(""),Xe=O(null),Ae=O(void 0),ae=O(null),Le=O(null),le=O(null),ws=O(0),xs=O(-1),Q=O(ie);Q.current=ie;const W=qe(()=>new fe,[]),Gn=O(()=>{}),pe=qe(()=>new Ji(P,()=>Gn.current()),[]);Gn.current=()=>{Q.current.active&&V({type:"spoke"})};const me=U(m=>Ve({question:m,exclude:n}),[n]),J=U((m,_)=>{d(S=>S.map(I=>I.id===m?_(I):I))},[]),Ce=U(()=>{ae.current?.stop(),Le.current?.hide(),le.current=null,b(null)},[]),qn=U(m=>{const _=Le.current;if(_){if(m.state==="DONE"||m.state==="FAILED"){const S=le.current?.turn;m.state==="DONE"&&S?.answer?.steps?.length&&e.outcome({outcome:"completed",question:S.question,feature:S.feature??null,answer:S.answer.text,steps:S.answer.steps,conversationId:Ae.current??null,messageId:S.messageId??null}),_.hide(),le.current=null,b(null),s(!0),v(m.state==="DONE"?"Guidance finished.":m.message??"Guidance stopped.");return}if(!m.step||!m.target){_.hide();return}if(_.show({target:m.target,caption:m.step.caption,index:m.stepIndex,total:m.total,isLast:m.stepIndex===m.total-1,busy:m.state!=="SPOTLIGHTING"}),m.state==="SPOTLIGHTING"){const S=m.message?`${m.message} `:"";v(`${S}Step ${m.stepIndex+1} of ${m.total}. ${m.step.caption}`)}}},[e]),Fn=U(async m=>{const _=le.current;if(!_)return null;const S=me(_.question);Xe.current=S;let I=null,z=!1;try{await e.ask({question:_.question,page:S.page,conversationId:Ae.current,continueFrom:m,onEvent:ce=>{ce.type==="answer"&&(I=ce.steps,z=ce.routeChanged===!0)}})}catch{return null}return I?{...S,steps:I,routeChanged:z}:null},[e,me]),Ze=U(()=>{Le.current||(Le.current=new kr(t,{onNext:()=>ae.current?.next(),onDone:()=>ae.current?.next(),onStop:()=>Ce(),onLost:()=>ae.current?.lost()})),ae.current||(ae.current=new br({rescan:()=>{const m=le.current,_=me(m?.question??"");return Xe.current=_,_},replan:Fn,onChange:qn,watch:m=>fr(m,300)}))},[qn,Fn,me,t,Ce]),vt=U(m=>{const _=m.answer?.steps,S=Xe.current;!_||_.length===0||!S||(Ze(),le.current={turnId:m.id,question:m.question,turn:m},b(m.id),s(!1),ae.current?.start(S,_))},[Ze]),wt=O(o);wt.current=o;const jn=O(Ee);jn.current=Ee;const Ie=U(async m=>{const _=m.trim();if(!_||f)return;s(!0),g(""),a(!0);const S=`t${ws.current+=1}`;let I=Wo(S,_);d(F=>[...F,I]),re(S),he(We),Te(We),ge(0);const z=F=>{I=F,J(S,()=>F)},ce=me(_);Xe.current=ce,Ze();try{await e.ask({question:_,page:ce.page,conversationId:Ae.current,onEvent:F=>{if(he(Y=>Uo(Y,F)),z(Zo(I,F,Ae)),F.type==="answer")if(re(null),wt.current||M(!0),F.steps?.length&&vt(I),Q.current.active){const Y=F.text;V({type:"answered"}),pe.play(et=>e.speak(Y,et))}else Z(Y=>Y+1)}})}catch{z({...I,error:"The support service is not reachable right now."})}finally{re(null),a(!1),Q.current.active&&Q.current.phase==="thinking"&&V({type:"unheard"})}},[f,e,Ze,J,pe,me,vt]),ks=U(async(m,_)=>{const S=Ae.current;if(!(!S||!m.messageId||m.reporting||m.escalationId)){J(m.id,I=>({...I,reporting:!0,reportBlocked:void 0}));try{const I=await e.escalate(S,m.messageId,_);if(!I.ok){J(m.id,Y=>({...Y,reporting:!1,reportBlocked:I.reason})),v("The report could not be sent.");return}const{escalationId:z,status:ce,notice:F}=I;J(m.id,Y=>({...Y,reporting:!1,escalationId:z,escalation:{id:z,status:Jo(ce)},textNotice:F})),v(F?`Your report was sent. ${An[F]}`:"Your report was sent."),Qo(e,z,Y=>{J(m.id,et=>(et.escalation?.status!==Y.status&&H(0),{...et,escalation:Y}))})}catch{J(m.id,I=>({...I,reporting:!1,reportBlocked:"failed"})),v("The report could not be sent.")}}},[e,J]),Ss=U(async(m,_)=>{const S=m.messageId;if(!S||m.rating)return;J(m.id,z=>({...z,rating:_})),v("Thank you for the feedback."),await e.feedback(S,_)||J(m.id,z=>({...z,rating:void 0}))},[e,J]);$(()=>{if(!l.some(S=>S.escalation&&!In.has(S.escalation.status)))return;const _=setInterval(()=>H(S=>S+1),1e3);return()=>clearInterval(_)},[l]),$(()=>{if(!q)return;const m=Date.now(),_=setInterval(()=>ge(Date.now()-m),500);return()=>clearInterval(_)},[q]),$(()=>{if(!q)return;const m=setInterval(()=>Te(_=>Go(_,jn.current)),Po);return()=>clearInterval(m)},[q]),$(()=>{o&&M(!1)},[o]);const xt=U(()=>{V({type:"end"}),Ye(!1),W.cancel(),y(!1),pe.stop(),yt(""),Z(m=>m+1)},[pe,W]),Es=U(()=>{if(!fe.supported){v("This browser cannot use the microphone.");return}s(!0),yt(""),V({type:"start"}),Ye(!0),v("The call has started. Speak when you are ready.")},[]),Ne=U(()=>{Q.current.active&&xt(),s(!1)},[xt]);$(()=>{if(!Yo()||!fe.supported)return;let m=!1;return fe.alreadyAllowed().then(_=>{if(!m){if(!_){Ye(!1);return}s(!0),V({type:"start"})}}),()=>{m=!0}},[]),$(()=>{const m=_=>{_.key==="Escape"&&(le.current?Ce():wt.current&&Ne())};return document.addEventListener("keydown",m),()=>document.removeEventListener("keydown",m)},[Ne,Ce]),$(()=>{i({open:()=>s(!0),close:()=>s(!1),ask:m=>void Ie(m)})},[Ie,i]),$(()=>()=>{ae.current?.dispose(),Le.current?.destroy(),pe.stop(),W.cancel()},[pe,W]),$(()=>{const m=Ki(e,n);return()=>m.dispose()},[e,n]);const Qe=U(async()=>{y(!1);let m=null;try{m=await W.stop()}catch{m=null}Q.current.active&&V({type:"heard"}),k(!0);try{if(!m){Q.current.active&&V({type:"unheard"});return}const _=await e.transcribe(m);_?(yt(_),g(_),Ie(_)):(v("I did not catch that. Try again."),Q.current.active&&V({type:"unheard"}))}catch{v("The microphone is not available."),Q.current.active&&V({type:"unheard"})}finally{k(!1)}},[Ie,e,W]),kt=O(Qe);kt.current=Qe,$(()=>{if(!no(ie))return;let m=!1;return(async()=>{try{await W.start(()=>void kt.current()),m?W.cancel():y(!0)}catch{v("Microphone access was declined."),V({type:"end"}),Ye(!1)}})(),()=>{m=!0,W.cancel(),y(!1)}},[ie,W]);const Ts=U(async()=>{if(E){await Qe();return}try{await W.start(()=>void kt.current()),y(!0)}catch{v("Microphone access was declined.")}},[Qe,W,E]),As=ie.active?"On a call":f?"Working on it":"We can show you on this page";return u("div",{class:"pl-root","data-position":r,children:[u("div",{class:"pl-sr",role:"status","aria-live":"polite",children:w}),o&&u(Vo,{title:"Support",subtitle:As,speaking:x&&!ie.active,onCall:ie.active||!fe.supported?void 0:Es,onStopSpeaking:()=>pe.stop(),onClose:Ne,onEscape:()=>le.current?Ce():Ne(),children:[u(jo,{turns:l,workingTurnId:q,stage:Ke,workingMs:Je,guidingTurnId:h,elapsedSeconds:G,scroll:xs,onShowMe:vt,onReport:(m,_)=>void ks(m,_),onRate:(m,_)=>void Ss(m,_)}),ie.active?u(ho,{state:ie,transcript:vs,onToggleMute:()=>V({type:"toggleMute"}),onEnd:xt}):u(go,{value:c,busy:f,voiceSupported:fe.supported,recording:E,transcribing:p,focusToken:R,onInput:g,onSubmit:()=>void Ie(c),onToggleRecording:()=>void Ts()})]}),u(mo,{open:o,unread:j,onClick:()=>o?Ne():s(!0)})]})}function Zo(e,t,n){switch(t.type){case"conversation":return n.current=t.conversationId,{...e,messageId:t.messageId};case"understanding":return{...e,feature:t.feature,memory:t.memory};case"probe":return{...e,probes:{...e.probes,[t.probe]:t.status==="running"?{status:"running"}:{status:"done",result:t.result}}};case"verdict":return{...e,verdict:t.verdict};case"answer":return{...e,answer:{text:t.text,steps:t.steps,escalation:t.escalation,noted:t.noted,plan:t.plan,sources:t.sources}};case"error":return{...e,error:t.message}}}function Qo(e,t,n){let r=!1;const i=async()=>{if(!r){try{const o=await e.escalation(t);if(n(o),In.has(o.status)){r=!0;return}}catch{}setTimeout(i,3e3)}};i()}class es{constructor(){this.buffer=""}push(t){this.buffer+=t.replace(/\r\n/g,`
`);const n=[];let r=this.buffer.indexOf(`

`);for(;r!==-1;){const i=Nn(this.buffer.slice(0,r));this.buffer=this.buffer.slice(r+2),i!==null&&n.push(i),r=this.buffer.indexOf(`

`)}return n}flush(){const t=this.buffer.trim();if(this.buffer="",!t)return[];const n=Nn(t);return n===null?[]:[n]}}function Nn(e){const t=[];for(const n of e.split(`
`)){if(!n||n.startsWith(":"))continue;const r=n.indexOf(":");if((r===-1?n:n.slice(0,r))!=="data")continue;const i=r===-1?"":n.slice(r+1);t.push(i.startsWith(" ")?i.slice(1):i)}return t.length===0?null:t.join(`
`)}const ts=["docs","interface","repository"],ns=["chat","page","product","mixed"],X=e=>typeof e=="object"&&e!==null;function Mn(e){let t;try{t=JSON.parse(e)}catch{return null}if(!X(t))return null;switch(t.type){case"conversation":return typeof t.conversationId!="string"||typeof t.messageId!="string"?null:{type:"conversation",conversationId:t.conversationId,messageId:t.messageId};case"understanding":{if(typeof t.feature!="string")return null;const n=ns.find(i=>i===t.intent)??"product",r=Array.isArray(t.memory)?t.memory.filter(i=>typeof i=="string"):[];return{type:"understanding",feature:t.feature,intent:n,memory:r}}case"probe":{if(typeof t.probe!="string"||!ts.includes(t.probe))return null;const n=t.probe;return t.status==="running"?{type:"probe",probe:n,status:"running"}:t.status==="done"&&X(t.result)?{type:"probe",probe:n,status:"done",result:rs(n,t.result)}:null}case"verdict":return X(t.verdict)?{type:"verdict",verdict:is(t.verdict)}:null;case"answer":{if(typeof t.text!="string")return null;const n={type:"answer",text:t.text,steps:as(t.steps),escalation:ds(t.escalation),noted:t.noted===!0},r=cs(t.plan);r&&(n.plan=r);const i=us(t.sources);return i.length&&(n.sources=i),t.routeChanged===!0&&(n.routeChanged=!0),n}case"error":return{type:"error",message:typeof t.message=="string"?t.message:"Something went wrong."};default:return null}}function rs(e,t){return{probe:e,hit:t.hit===!0,score:typeof t.score=="number"?t.score:null,summary:typeof t.summary=="string"?t.summary:"",evidence:t.evidence??null,latencyMs:typeof t.latencyMs=="number"?t.latencyMs:0}}function is(e){const t=e.outcome;return{outcome:t==="answer"||t==="absent"?t:"hedge",confidence:typeof e.confidence=="number"?e.confidence:0,reasoning:typeof e.reasoning=="string"?e.reasoning:"",feature:typeof e.feature=="string"?e.feature:""}}const os=["click","input","navigation","manual"];function ss(e){if(!X(e)||typeof e.role!="string"||typeof e.name!="string"||typeof e.route!="string"||e.name.trim()===""||e.route==="")return null;const t={role:e.role,name:e.name,route:e.route};return typeof e.landmark=="string"&&e.landmark&&(t.landmark=e.landmark),typeof e.href=="string"&&e.href&&(t.href=e.href),t}function as(e){if(!Array.isArray(e))return null;const t=[];for(const n of e){if(!X(n)||typeof n.caption!="string")continue;const r=ss(n.control),i=typeof n.target=="string"?n.target:null;if(i===null&&!r)continue;const o={target:i,caption:n.caption,advanceOn:typeof n.advanceOn=="string"&&os.includes(n.advanceOn)?n.advanceOn:"click"};r&&(o.control=r),t.push(o)}return t.length===0||t[0].target===null?null:t}const ls=["graph","cached","page","memory"];function cs(e){if(!X(e)||typeof e.total!="number"||!Number.isFinite(e.total))return null;const t={source:typeof e.source=="string"&&ls.includes(e.source)?e.source:"page",total:Math.max(0,Math.round(e.total))};return X(e.destination)&&typeof e.destination.route=="string"&&(t.destination={route:e.destination.route,title:typeof e.destination.title=="string"?e.destination.title:""}),t}function us(e){if(!Array.isArray(e))return[];const t=[];for(const n of e)!X(n)||typeof n.title!="string"||n.title.trim()===""||t.push({title:n.title,url:typeof n.url=="string"&&n.url?n.url:null});return t}function ds(e){if(!X(e))return{offered:!1};if(e.offered===!0&&X(e.request)){const t=e.request;return e.textNotice===!0?{offered:!0,request:t,textNotice:!0}:{offered:!0,request:t}}return e.reason==="no_repository"?{offered:!1,reason:"no_repository"}:{offered:!1}}const On="lantern:visitor";function Rn(){const e=new Uint8Array(16);return crypto.getRandomValues(e),Array.from(e,t=>t.toString(16).padStart(2,"0")).join("")}function Pn(){try{const e=localStorage.getItem(On);if(e&&/^[0-9a-f]{32}$/.test(e))return e;const t=Rn();return localStorage.setItem(On,t),t}catch{return Rn()}}function ps(e){return e==="subscribed"||e==="not_needed"?e:"unavailable"}class fs{constructor(t){this.config=t}url(t){return`${this.config.apiBase.replace(/\/$/,"")}${t}`}async ask({question:t,page:n,conversationId:r,continueFrom:i,signal:o,onEvent:s}){const l={key:this.config.key,question:t,page:n,visitorId:Pn()};r&&(l.conversationId=r),typeof i=="number"&&(l.continueFrom=i);const d=await fetch(this.url("/api/chat"),{method:"POST",headers:{"content-type":"application/json",accept:"text/event-stream"},body:JSON.stringify(l),signal:o});if(!d.ok||!d.body)throw new Error(`Chat request failed (${d.status})`);const c=d.body.getReader(),g=new TextDecoder,f=new es;for(;;){const{done:a,value:h}=await c.read();if(a)break;for(const b of f.push(g.decode(h,{stream:!0}))){const w=Mn(b);w&&s(w)}}for(const a of f.flush()){const h=Mn(a);h&&s(h)}}async escalate(t,n,r){const i={key:this.config.key,conversationId:t,messageId:n,visitorId:Pn()};r&&(i.notify={phone:r,consent:!0});const o=await fetch(this.url("/api/escalate"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(i)}),s=await o.json().catch(()=>({}));if(!o.ok||!s.escalationId)return{ok:!1,reason:s.reason==="no_repository"?"no_repository":"failed"};const l={ok:!0,escalationId:s.escalationId,status:s.status??"queued"};return r&&(l.notice=ps(s.notify)),l}async escalation(t){const n=await fetch(this.url(`/api/escalations/${encodeURIComponent(t)}?key=${encodeURIComponent(this.config.key)}`));if(!n.ok)throw new Error(`Could not read the report status (${n.status})`);return await n.json()}async feedback(t,n,r){const i={key:this.config.key,messageId:t,rating:n};r&&(i.note=r);try{return(await fetch(this.url("/api/feedback"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(i)})).ok}catch{return!1}}async observe(t){try{await fetch(this.url("/api/site/observe"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,...t}),keepalive:!0})}catch{}}async outcome(t){try{await fetch(this.url("/api/guide/outcome"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,...t}),keepalive:!0})}catch{}}async transcribe(t){const n=new FormData;n.append("key",this.config.key),n.append("file",t,"speech.webm");const r=await fetch(this.url("/api/transcribe"),{method:"POST",body:n});if(!r.ok)throw new Error(`Could not transcribe that (${r.status})`);const i=await r.json();return typeof i.text=="string"?i.text:""}async speak(t,n){const r=await fetch(this.url("/api/speak"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,text:t}),signal:n});if(!r.ok)throw new Error(`Could not read that out (${r.status})`);return r}}const Se={"--pl-accent":"#2e6f54","--pl-ink":"#17201c","--pl-muted":"#5b645f","--pl-glass":"rgba(255, 253, 247, 0.6)","--pl-radius":"18px"},$n=`
:host {
  --pl-accent: ${Se["--pl-accent"]};
  --pl-ink: ${Se["--pl-ink"]};
  --pl-muted: ${Se["--pl-muted"]};
  --pl-glass: ${Se["--pl-glass"]};
  --pl-radius: ${Se["--pl-radius"]};

  --pl-accent-deep: #174633;
  /* The accent as text: the deep green on light glass, a lighter green on dark. */
  --pl-accent-text: var(--pl-accent);
  --pl-glass-strong: rgba(255, 253, 247, 0.82);
  --pl-border: rgba(255, 255, 255, 0.72);
  --pl-hairline: rgba(23, 32, 28, 0.1);
  --pl-field: rgba(255, 255, 255, 0.5);
  --pl-bubble: rgba(255, 255, 255, 0.62);
  --pl-shadow: 0 28px 74px rgba(23, 32, 28, 0.24), 0 2px 10px rgba(23, 32, 28, 0.08);
  --pl-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  --pl-scrim: rgba(14, 18, 16, 0.42);
  /* An input that is wrong, and the sentence that says why. */
  --pl-danger: #a3231c;
  --pl-blur: blur(32px) saturate(170%);
  --pl-serif: ui-serif, Georgia, "Times New Roman", serif;

  all: initial;
  position: fixed;
  inset: auto 0 0 auto;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--pl-ink);
  -webkit-font-smoothing: antialiased;
}

:host([data-pl-scheme="dark"]) {
  --pl-ink: #f2f2f5;
  --pl-muted: #b3b3bd;
  --pl-accent-text: #9fd0b5;
  --pl-accent-deep: #2e6f54;
  --pl-glass: rgba(28, 30, 29, 0.66);
  --pl-glass-strong: rgba(30, 30, 36, 0.92);
  --pl-border: rgba(255, 255, 255, 0.14);
  --pl-hairline: rgba(255, 255, 255, 0.1);
  --pl-field: rgba(255, 255, 255, 0.07);
  --pl-bubble: rgba(255, 255, 255, 0.08);
  --pl-shadow: 0 28px 74px rgba(0, 0, 0, 0.5), 0 2px 10px rgba(0, 0, 0, 0.35);
  --pl-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  --pl-scrim: rgba(4, 6, 5, 0.55);
  --pl-danger: #ffb4ab;
}

*, *::before, *::after { box-sizing: border-box; }

.pl-root {
  position: fixed;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}
.pl-root[data-position="right"] { right: 22px; align-items: flex-end; }
.pl-root[data-position="left"] { left: 22px; align-items: flex-start; }

/* Launcher */
.pl-launcher {
  appearance: none;
  position: relative;
  width: 62px;
  height: 62px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: var(--pl-accent-deep);
  box-shadow:
    0 16px 38px rgba(23, 70, 51, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  color: #fffdf7;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}
.pl-launcher:hover {
  transform: translateY(-2px);
  background: var(--pl-accent);
  box-shadow:
    0 20px 44px rgba(23, 70, 51, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
.pl-launcher:active { transform: translateY(0) scale(0.96); }
.pl-launcher[aria-expanded="true"] { background: var(--pl-accent); }
.pl-launcher:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 3px; }
.pl-launcher svg { width: 26px; height: 26px; display: block; }
/* One small mark, no count: the panel is one conversation, so a number would always read "1". */
.pl-launcher__dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #fffdf7;
  box-shadow: 0 0 0 2px var(--pl-accent-deep);
}

/* Panel */
.pl-panel {
  width: min(380px, calc(100vw - 32px));
  height: min(560px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: var(--pl-radius);
  border: 1px solid var(--pl-border);
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0) 34%),
    radial-gradient(120% 80% at 90% 0%, rgba(46, 111, 84, 0.1), transparent 60%),
    var(--pl-glass);
  -webkit-backdrop-filter: var(--pl-blur);
  backdrop-filter: var(--pl-blur);
  box-shadow: var(--pl-shadow);
  overflow: hidden;
  transform-origin: bottom right;
  animation: pl-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.pl-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: var(--pl-highlight);
}
.pl-root[data-position="left"] .pl-panel { transform-origin: bottom left; }
:host([data-pl-scheme="dark"]) .pl-panel::before { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1); }
/* The light sheen across the top of the glass is tuned for a pale ground. At full strength on a
   dark host it reads as a smudge, so the dark scheme gets the same shape at a fifth of it. */
:host([data-pl-scheme="dark"]) .pl-panel {
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 34%),
    radial-gradient(120% 80% at 90% 0%, rgba(46, 111, 84, 0.18), transparent 60%),
    var(--pl-glass);
}

@keyframes pl-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }

.pl-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--pl-hairline);
}
.pl-header__title {
  margin: 0;
  font-family: var(--pl-serif);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.15;
}
.pl-header__sub { font-size: 12px; color: var(--pl-muted); margin: 2px 0 0; }
.pl-header__text { min-width: 0; }
.pl-header__text p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-header__spacer { flex: 1; }

.pl-icon-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--pl-muted);
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-icon-btn:hover { background: var(--pl-field); color: var(--pl-ink); }
.pl-icon-btn:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-icon-btn[aria-pressed="true"] { color: var(--pl-accent-text); background: color-mix(in srgb, var(--pl-accent) 12%, transparent); }
.pl-icon-btn svg { width: 17px; height: 17px; }

/* Messages */
.pl-messages {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}
.pl-empty { margin: auto 0; text-align: center; color: var(--pl-muted); padding: 8px 12px; }
.pl-empty h3 {
  margin: 0 0 8px;
  font-family: var(--pl-serif);
  font-size: 22px;
  font-weight: 500;
  color: var(--pl-ink);
}
.pl-empty p { margin: 0; font-size: 14px; }

.pl-msg { max-width: 88%; padding: 9px 12px; border-radius: 14px; font-size: 14px; }
.pl-msg--user {
  align-self: flex-end;
  background: color-mix(in srgb, var(--pl-accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--pl-accent) 24%, transparent);
}
.pl-msg--agent { align-self: flex-start; background: var(--pl-bubble); border: 1px solid var(--pl-hairline); }
.pl-msg p { margin: 0; white-space: pre-wrap; }

/* One quiet line when the agent already knows this visitor. */
.pl-recall {
  align-self: flex-start;
  margin: -4px 0 0;
  padding: 0 2px;
  color: var(--pl-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

/* Cards */
.pl-card {
  align-self: stretch;
  border: 1px solid var(--pl-hairline);
  background: var(--pl-glass-strong);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pl-card p { margin: 0; font-size: 14px; white-space: pre-wrap; }
.pl-card__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pl-muted); }
.pl-card__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pl-card__note { color: var(--pl-muted); font-size: 12.5px; }

/* The report, and the optional text about it */
.pl-report { display: flex; flex-direction: column; gap: 10px; }
.pl-notify { display: flex; flex-direction: column; gap: 8px; }
.pl-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; cursor: pointer; }
.pl-check input { width: 15px; height: 15px; margin: 1.5px 0 0; flex: none; accent-color: var(--pl-accent); cursor: pointer; }
.pl-check input:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-check input:disabled, .pl-check:has(input:disabled) { cursor: default; }
.pl-input {
  appearance: none;
  width: 100%;
  font: inherit;
  font-size: 14px;
  color: var(--pl-ink);
  background: var(--pl-field);
  border: 1px solid var(--pl-hairline);
  border-radius: 10px;
  padding: 7px 10px;
}
.pl-input::placeholder { color: var(--pl-muted); }
.pl-input:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 1px; }
.pl-input[aria-invalid="true"] { border-color: var(--pl-danger); }
.pl-input:disabled { opacity: 0.55; }
.pl-card .pl-notify__hint { color: var(--pl-muted); font-size: 12px; line-height: 1.45; }
.pl-card .pl-notify__error { color: var(--pl-danger); font-size: 12px; line-height: 1.45; }

.pl-btn {
  appearance: none;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  border-radius: 10px;
  padding: 7px 12px;
  border: 1px solid var(--pl-hairline);
  background: var(--pl-field);
  color: var(--pl-ink);
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.pl-btn:hover { transform: translateY(-1px); }
.pl-btn:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-btn:disabled { opacity: 0.55; cursor: default; transform: none; }
.pl-btn--accent { background: var(--pl-accent-deep); border-color: transparent; color: #fffdf7; }
.pl-btn--accent:hover { background: var(--pl-accent); }
.pl-btn--quiet { background: transparent; color: var(--pl-muted); }
.pl-btn svg { width: 15px; height: 15px; flex: none; }
.pl-btn--call,
.pl-btn--end {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 11px;
  white-space: nowrap;
}
.pl-btn--call { background: color-mix(in srgb, var(--pl-accent) 13%, transparent); border-color: color-mix(in srgb, var(--pl-accent) 30%, transparent); color: var(--pl-accent-deep); }
.pl-btn--call:hover { background: color-mix(in srgb, var(--pl-accent) 20%, transparent); }
:host([data-pl-scheme="dark"]) .pl-btn--call { color: var(--pl-ink); }
.pl-btn--end { background: #b3261e; border-color: transparent; color: #fffdf7; }
.pl-btn--end:hover { background: #c9372f; }

/* The working state: three dots and one honest line about what is happening. */
.pl-thinking {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-radius: 14px;
  background: var(--pl-bubble);
  border: 1px solid var(--pl-hairline);
  max-width: 88%;
}
.pl-thinking__line { font-size: 13px; color: var(--pl-muted); }
.pl-typing { display: inline-flex; gap: 4px; flex: none; }
.pl-typing span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--pl-accent);
  opacity: 0.35;
  animation: pl-typing 1.25s ease-in-out infinite;
}
.pl-typing span:nth-child(2) { animation-delay: 0.16s; }
.pl-typing span:nth-child(3) { animation-delay: 0.32s; }
@keyframes pl-typing { 0%, 60%, 100% { opacity: 0.3; transform: none; } 30% { opacity: 1; transform: translateY(-2px); } }

/* Copy and rating, quiet until the pointer is on them. */
.pl-answer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px solid var(--pl-hairline);
}
.pl-answer-actions__spacer { flex: 1; }
.pl-answer-actions__thanks { font-size: 11.5px; color: var(--pl-muted); }
.pl-mini {
  appearance: none;
  font: inherit;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--pl-muted);
  border-radius: 8px;
  padding: 4px 7px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-mini:hover:not(:disabled) { background: var(--pl-field); color: var(--pl-ink); }
.pl-mini:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-mini:disabled { opacity: 0.4; cursor: default; }
.pl-mini svg { width: 14px; height: 14px; }
.pl-mini--icon { padding: 5px; }

/* Call bar, in the composer's place */
.pl-call {
  border-top: 1px solid var(--pl-hairline);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pl-call__state { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; }
.pl-call__body { min-width: 0; display: flex; flex-direction: column; }
.pl-call__label { font-size: 13px; font-weight: 550; }
.pl-call__transcript {
  font-size: 11.5px;
  color: var(--pl-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-call__pulse {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 999px;
  background: var(--pl-accent);
  animation: pl-pulse 1.4s ease-in-out infinite;
}
.pl-call__pulse--thinking { animation-duration: 0.9s; }
.pl-call__pulse--speaking { animation: none; opacity: 1; }
.pl-call__pulse--muted { animation: none; background: var(--pl-muted); opacity: 0.5; }

/* Escalation timeline */
.pl-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pl-timeline li { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; }
.pl-timeline__mark {
  width: 8px; height: 8px; margin-top: 6px; border-radius: 999px; flex: none;
  border: 1px solid var(--pl-muted); background: transparent;
}
.pl-timeline li[data-state="done"] .pl-timeline__mark { background: var(--pl-muted); }
.pl-timeline li[data-state="current"] .pl-timeline__mark { background: var(--pl-accent); border-color: var(--pl-accent); }
.pl-timeline li[data-state="pending"] { color: var(--pl-muted); }
.pl-timeline__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pl-timeline__note { color: var(--pl-muted); font-size: 11.5px; }
.pl-link { color: var(--pl-accent-text); text-decoration: none; font-weight: 550; }
.pl-link:hover { text-decoration: underline; }

/* Composer */
.pl-composer {
  border-top: 1px solid var(--pl-hairline);
  padding: 10px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.pl-composer__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--pl-field);
  border: 1px solid var(--pl-hairline);
  border-radius: 13px;
  padding: 6px 8px 6px 12px;
}
.pl-composer__field:focus-within { border-color: color-mix(in srgb, var(--pl-accent) 45%, transparent); }
.pl-composer textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--pl-ink);
  max-height: 96px;
  padding: 3px 0;
  /* The field grows to fit its text, so it only scrolls once it hits the cap. Left on auto it
     shows a scrollbar with stepper arrows on a one-line question. */
  overflow-y: hidden;
  scrollbar-width: thin;
}
.pl-composer textarea::-webkit-scrollbar { width: 6px; }
.pl-composer textarea::-webkit-scrollbar-button { display: none; }
.pl-composer textarea::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--pl-hairline); }
.pl-composer textarea::placeholder { color: var(--pl-muted); }
.pl-send {
  appearance: none;
  border: 0;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 11px;
  background: var(--pl-accent-deep);
  color: #fffdf7;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.pl-send:hover:not(:disabled) { background: var(--pl-accent); }
.pl-send:disabled { opacity: 0.35; cursor: default; }
.pl-send:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-send svg { width: 16px; height: 16px; }
.pl-hint { font-size: 11px; color: var(--pl-muted); padding: 0 12px 8px; }

.pl-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Spotlight */
.pl-spot {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
  pointer-events: none;
}
.pl-spot::backdrop { background: transparent; }
.pl-spot--fallback { z-index: 2147483001; }
.pl-spot__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pl-spot__scrim { fill: var(--pl-scrim); transition: opacity 160ms ease; }
.pl-spot__ring {
  fill: none;
  stroke: var(--pl-accent);
  stroke-width: 2;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--pl-accent) 55%, transparent));
  transition: x 160ms ease, y 160ms ease, width 160ms ease, height 160ms ease;
}
.pl-spot__bubble {
  position: absolute;
  top: 0;
  left: 0;
  width: 260px;
  pointer-events: auto;
  border-radius: 14px;
  border: 1px solid var(--pl-border);
  background: var(--pl-glass-strong);
  -webkit-backdrop-filter: var(--pl-blur);
  backdrop-filter: var(--pl-blur);
  box-shadow: var(--pl-shadow), var(--pl-highlight);
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--pl-ink);
  transition: transform 160ms ease;
}
/* A caret on the edge facing the ring, so the caption reads as being about that control and
   not as a notice that happens to be nearby. */
.pl-spot__bubble::after {
  content: "";
  position: absolute;
  left: 24px;
  width: 11px;
  height: 11px;
  background: var(--pl-glass-strong);
  border: 1px solid var(--pl-border);
  transform: rotate(45deg);
}
.pl-spot__bubble[data-side="below"]::after {
  top: -6.5px;
  border-right: 0;
  border-bottom: 0;
}
.pl-spot__bubble[data-side="above"]::after {
  bottom: -6.5px;
  border-left: 0;
  border-top: 0;
}
.pl-spot__counter {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pl-accent-text);
}
.pl-spot__caption { margin: 0; font-size: 14px; line-height: 1.45; }
.pl-spot__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 1px; }
.pl-spot--busy .pl-spot__caption { opacity: 0.6; }

@media (prefers-reduced-motion: reduce) {
  .pl-panel { animation: none; }
  .pl-launcher, .pl-btn, .pl-spot__bubble, .pl-spot__ring, .pl-spot__scrim { transition: none; }
  .pl-typing span { animation: none; opacity: 0.75; }
  .pl-call__pulse { animation: none; opacity: 1; }
  .pl-mini { transition: none; }
}
`;function hs(e){if(typeof CSSStyleSheet<"u"&&"adoptedStyleSheets"in Document.prototype)try{const n=new CSSStyleSheet;n.replaceSync($n),e.adoptedStyleSheets=[...e.adoptedStyleSheets,n];return}catch{}const t=document.createElement("style");t.textContent=$n,e.appendChild(t)}function Dn(){const e=[];if(typeof document.elementFromPoint=="function"){const t=document.elementFromPoint(Math.max(innerWidth-120,0),Math.max(innerHeight-30,0));for(let n=t;n;n=n.parentElement)n.tagName.toLowerCase()!=="lantern-widget"&&e.push(n)}e.push(document.body,document.documentElement);for(const t of e){if(!t)continue;const n=getComputedStyle(t).backgroundColor,r=gs(n);if(r!==null)return r<.4?"dark":"light"}return typeof matchMedia=="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function gs(e){const t=e.match(/rgba?\(([^)]+)\)/);if(!t)return null;const n=t[1].split(",").map(s=>Number.parseFloat(s.trim()));if(n.length<3||n.some(Number.isNaN)||n.length>3&&n[3]===0)return null;const[r,i,o]=n;return(.2126*r+.7152*i+.0722*o)/255}const Hn="lantern-widget",ms="lantern_ask";function bs(){return new URLSearchParams(location.search).get(ms)?.trim()??""}function _s(){const t=document.currentScript??document.querySelector("script[data-key]"),n=t?.dataset.key?.trim();if(!n)return console.warn("[lantern] no data-key on the script tag, the widget will not load"),null;const r=t?.src?new URL(t.src,location.href).origin:location.origin,i=t?.dataset.api?.trim()||r,o=t?.dataset.position==="left"?"left":"right";return{key:n,apiBase:i,position:o}}function Un(e){if(document.querySelector(Hn))return;let t=bs();const n=document.createElement(Hn);n.setAttribute("data-pl-scheme",Dn()),document.body.appendChild(n);const r=n.attachShadow({mode:"open"});hs(r);const i=document.createElement("div");r.appendChild(i);const o=new MutationObserver(()=>n.setAttribute("data-pl-scheme",Dn()));o.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]}),o.observe(document.body,{attributes:!0,attributeFilter:["class","style","data-theme"]});const s=new fs({apiBase:e.apiBase,key:e.key});Xn(u(Xo,{client:s,shadow:r,host:n,position:e.position,register:l=>{if(window.Lantern=l,t){const d=t;t="",setTimeout(()=>window.Lantern?.ask(d),400)}}}),i)}function ys(){const e=_s();e&&(document.body?Un(e):document.addEventListener("DOMContentLoaded",()=>Un(e),{once:!0}))}ys()})();
