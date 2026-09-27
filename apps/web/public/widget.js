(function(){"use strict";var Ie,T,kt,oe,St,Et,Tt,et,Me,me,At,tt,nt,rt,Ne={},Oe=[],Fn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,Re=Array.isArray;function ee(e,t){for(var n in t)e[n]=t[n];return e}function it(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function jn(e,t,n){var r,i,o,s={};for(o in t)o=="key"?r=t[o]:o=="ref"?i=t[o]:s[o]=t[o];if(arguments.length>2&&(s.children=arguments.length>3?Ie.call(arguments,2):n),typeof e=="function"&&e.defaultProps!=null)for(o in e.defaultProps)s[o]===void 0&&(s[o]=e.defaultProps[o]);return Pe(e,s,r,i,null)}function Pe(e,t,n,r,i){var o={type:e,props:t,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:i??++kt,__i:-1,__u:0};return i==null&&T.vnode!=null&&T.vnode(o),o}function ae(e){return e.children}function De(e,t){this.props=e,this.context=t}function le(e,t){if(t==null)return e.__?le(e.__,e.__i+1):null;for(var n;t<e.__k.length;t++)if((n=e.__k[t])!=null&&n.__e!=null)return n.__e;return typeof e.type=="function"?le(e):null}function zn(e){if(e.__P&&e.__d){var t=e.__v,n=t.__e,r=[],i=[],o=ee({},t);o.__v=t.__v+1,T.vnode&&T.vnode(o),ot(e.__P,o,t,e.__n,e.__P.namespaceURI,32&t.__u?[n]:null,r,n??le(t),!!(32&t.__u),i),o.__v=t.__v,o.__.__k[o.__i]=o,Pt(r,o,i),t.__e=t.__=null,o.__e!=n&&Lt(o)}}function Lt(e){if((e=e.__)!=null&&e.__c!=null)return e.__e=e.__c.base=null,e.__k.some(function(t){if(t!=null&&t.__e!=null)return e.__e=e.__c.base=t.__e}),Lt(e)}function Ct(e){(!e.__d&&(e.__d=!0)&&oe.push(e)&&!$e.__r++||St!=T.debounceRendering)&&((St=T.debounceRendering)||Et)($e)}function $e(){try{for(var e,t=1;oe.length;)oe.length>t&&oe.sort(Tt),e=oe.shift(),t=oe.length,zn(e)}finally{oe.length=$e.__r=0}}function It(e,t,n,r,i,o,s,l,p,c,f){var h,a,g,b,w,v,E=r&&r.__k||Oe,_=t.length;for(p=Bn(n,t,E,p,_),h=0;h<_;h++)(g=n.__k[h])!=null&&(a=g.__i!=-1&&E[g.__i]||Ne,g.__i=h,v=ot(e,g,a,i,o,s,l,p,c,f),b=g.__e,g.ref&&a.ref!=g.ref&&(a.ref&&st(a.ref,null,g),f.push(g.ref,g.__c||b,g)),w==null&&b!=null&&(w=b),4&g.__u?(p=Mt(g,p,e),a.__e&&(a.__e=null)):typeof g.type=="function"&&v!==void 0?p=v:b&&(p=b.nextSibling),g.__u&=-7);return n.__e=w,p}function Bn(e,t,n,r,i){var o,s,l,p,c,f=n.length,h=f,a=0;for(e.__k=new Array(i),o=0;o<i;o++)(s=t[o])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=e.__k[o]=Pe(null,s,null,null,null):Re(s)?s=e.__k[o]=Pe(ae,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=e.__k[o]=Pe(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):e.__k[o]=s,p=o+a,s.__=e,s.__b=e.__b+1,l=null,(c=s.__i=Vn(s,n,p,h))!=-1&&(h--,(l=n[c])&&(l.__u|=2)),l==null||l.__v==null?(c==-1&&(i>f?a--:i<f&&a++),typeof s.type!="function"&&(s.__u|=4)):c!=p&&(c==p-1?a--:c==p+1?a++:(c>p?a--:a++,s.__u|=4))):e.__k[o]=null;if(h)for(o=0;o<f;o++)(l=n[o])!=null&&(2&l.__u)==0&&(l.__e==r&&(r=le(l)),$t(l,l));return r}function Mt(e,t,n){var r,i;if(typeof e.type=="function"){for(r=e.__k,i=0;r&&i<r.length;i++)r[i]&&(r[i].__=e,t=Mt(r[i],t,n));return t}e.__e!=t&&(t&&e.type&&!t.parentNode&&(t=le(e)),t=n.insertBefore(e.__e,t||null));do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function Vn(e,t,n,r){var i,o,s,l=e.key,p=e.type,c=t[n],f=c!=null&&(2&c.__u)==0;if(c===null&&l==null||f&&l==c.key&&p==c.type)return n;if(r>(f?1:0)){for(i=n-1,o=n+1;i>=0||o<t.length;)if((c=t[s=i>=0?i--:o++])!=null&&(2&c.__u)==0&&l==c.key&&p==c.type)return s}return-1}function Nt(e,t,n){t[0]=="-"?e.setProperty(t,n??""):e[t]=n==null?"":typeof n!="number"||Fn.test(t)?n:n+"px"}function He(e,t,n,r,i){var o,s;e:if(t=="style")if(typeof n=="string")e.style.cssText=n;else{if(typeof r=="string"&&(e.style.cssText=r=""),r)for(t in r)n&&t in n||Nt(e.style,t,"");if(n)for(t in n)r&&n[t]==r[t]||Nt(e.style,t,n[t])}else if(t[0]=="o"&&t[1]=="n")o=t!=(t=t.replace(At,"$1")),s=t.toLowerCase(),t=s in e||t=="onFocusOut"||t=="onFocusIn"?s.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+o]=n,n?r?n[me]=r[me]:(n[me]=tt,e.addEventListener(t,o?rt:nt,o)):e.removeEventListener(t,o?rt:nt,o);else{if(i=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&n==1?"":n))}}function Ot(e){return function(t){if(this.l){var n=this.l[t.type+e];if(t[Me]==null)t[Me]=tt++;else if(t[Me]<n[me])return;return n(T.event?T.event(t):t)}}}function ot(e,t,n,r,i,o,s,l,p,c){var f,h,a,g,b,w,v,E,_,d,k,x,R,G,$,F,I=t.type;if(t.constructor!==void 0)return null;128&n.__u&&(p=!!(32&n.__u),o=[l=t.__e=n.__e]),(f=T.__b)&&f(t);e:if(typeof I=="function"){h=s.length;try{if(_=t.props,d=I.prototype&&I.prototype.render,k=(f=I.contextType)&&r[f.__c],x=f?k?k.props.value:f.__:r,n.__c?E=(a=t.__c=n.__c).__=a.__E:(d?t.__c=a=new I(_,x):(t.__c=a=new De(_,x),a.constructor=I,a.render=Kn),k&&k.sub(a),a.state||(a.state={}),a.__n=r,g=a.__d=!0,a.__h=[],a._sb=[]),d&&a.__s==null&&(a.__s=a.state),d&&I.getDerivedStateFromProps!=null&&(a.__s==a.state&&(a.__s=ee({},a.__s)),ee(a.__s,I.getDerivedStateFromProps(_,a.__s))),b=a.props,w=a.state,a.__v=t,g)d&&I.getDerivedStateFromProps==null&&a.componentWillMount!=null&&a.componentWillMount(),d&&a.componentDidMount!=null&&a.__h.push(a.componentDidMount);else{if(d&&I.getDerivedStateFromProps==null&&_!==b&&a.componentWillReceiveProps!=null&&a.componentWillReceiveProps(_,x),t.__v==n.__v||!a.__e&&a.shouldComponentUpdate!=null&&a.shouldComponentUpdate(_,a.__s,x)===!1){t.__v!=n.__v&&(a.props=_,a.state=a.__s,a.__d=!1),t.__e=n.__e,t.__k=n.__k,t.__k.some(function(N){N&&(N.__=t)}),Oe.push.apply(a.__h,a._sb),a._sb=[],a.__h.length&&s.push(a),l=le(n);break e}a.componentWillUpdate!=null&&a.componentWillUpdate(_,a.__s,x),d&&a.componentDidUpdate!=null&&a.__h.push(function(){a.componentDidUpdate(b,w,v)})}if(a.context=x,a.props=_,a.__P=e,a.__e=!1,R=T.__r,G=0,d)a.state=a.__s,a.__d=!1,R&&R(t),f=a.render(a.props,a.state,a.context),Oe.push.apply(a.__h,a._sb),a._sb=[];else do a.__d=!1,R&&R(t),f=a.render(a.props,a.state,a.context),a.state=a.__s;while(a.__d&&++G<25);a.state=a.__s,a.getChildContext!=null&&(r=ee(ee({},r),a.getChildContext())),d&&!g&&a.getSnapshotBeforeUpdate!=null&&(v=a.getSnapshotBeforeUpdate(b,w)),$=f!=null&&f.type===ae&&f.key==null?Dt(f.props.children):f,l=It(e,Re($)?$:[$],t,n,r,i,o,s,l,p,c),a.base=t.__e,t.__u&=-161,a.__h.length&&s.push(a),E&&(a.__E=a.__=null)}catch(N){if(s.length=h,t.__v=null,p||o!=null){if(N.then){for(t.__u|=p?160:128;l&&l.nodeType==8&&l.nextSibling;)l=l.nextSibling;o!=null&&(o[o.indexOf(l)]=null),t.__e=l}else if(o!=null)for(F=o.length;F--;)it(o[F])}else t.__e=n.__e;t.__k==null&&(t.__k=n.__k||[]),N.then||Rt(t),T.__e(N,t,n)}}else o==null&&t.__v==n.__v?(t.__k=n.__k,t.__e=n.__e):l=t.__e=Wn(n.__e,t,n,r,i,o,s,p,c);return(f=T.diffed)&&f(t),128&t.__u?void 0:l}function Rt(e){e&&(e.__c&&(e.__c.__e=!0),e.__k&&e.__k.some(Rt))}function Pt(e,t,n){for(var r=0;r<n.length;r++)st(n[r],n[++r],n[++r]);T.__c&&T.__c(t,e),e.some(function(i){try{e=i.__h,i.__h=[],e.some(function(o){o.call(i)})}catch(o){T.__e(o,i.__v)}})}function Dt(e){return typeof e!="object"||e==null||e.__b>0?e:Re(e)?e.map(Dt):e.constructor!==void 0?null:ee({},e)}function Wn(e,t,n,r,i,o,s,l,p){var c,f,h,a,g,b,w,v=n.props||Ne,E=t.props,_=t.type;if(_=="svg"?i="http://www.w3.org/2000/svg":_=="math"?i="http://www.w3.org/1998/Math/MathML":i||(i="http://www.w3.org/1999/xhtml"),o!=null){for(c=0;c<o.length;c++)if((g=o[c])&&"setAttribute"in g==!!_&&(_?g.localName==_:g.nodeType==3)){e=g,o[c]=null;break}}if(e==null){if(_==null)return document.createTextNode(E);e=document.createElementNS(i,_,E.is&&E),l&&(T.__m&&T.__m(t,o),l=!1),o=null}if(_==null)v===E||l&&e.data==E||(e.data=E);else{if(o=_=="textarea"&&E.defaultValue!=null?null:o&&Ie.call(e.childNodes),!l&&o!=null)for(v={},c=0;c<e.attributes.length;c++)v[(g=e.attributes[c]).name]=g.value;for(c in v)g=v[c],c=="dangerouslySetInnerHTML"?h=g:c=="children"||c in E||c=="value"&&"defaultValue"in E||c=="checked"&&"defaultChecked"in E||He(e,c,null,g,i);for(c in E)g=E[c],c=="children"?a=g:c=="dangerouslySetInnerHTML"?f=g:c=="value"?b=g:c=="checked"?w=g:l&&typeof g!="function"||v[c]===g||He(e,c,g,v[c],i);if(f)l||h&&(f.__html==h.__html||f.__html==e.innerHTML)||(e.innerHTML=f.__html),t.__k=[];else if(h&&(e.innerHTML=""),It(t.type=="template"?e.content:e,Re(a)?a:[a],t,n,r,_=="foreignObject"?"http://www.w3.org/1999/xhtml":i,o,s,o?o[0]:n.__k&&le(n,0),l,p),o!=null)for(c=o.length;c--;)it(o[c]);l&&_!="textarea"||(c="value",_=="progress"&&b==null?e.removeAttribute("value"):b!=null&&(b!==e[c]||_=="progress"&&!b||_=="option"&&b!=v[c])&&He(e,c,b,v[c],i),c="checked",w!=null&&w!=e[c]&&He(e,c,w,v[c],i))}return e}function st(e,t,n){try{if(typeof e=="function"){var r=typeof e.__u=="function";r&&e.__u(),r&&t==null||(e.__u=e(t))}else e.current=t}catch(i){T.__e(i,n)}}function $t(e,t,n){var r,i;if(T.unmount&&T.unmount(e),(r=e.ref)&&(r.current&&r.current!=e.__e||st(r,null,t)),(r=e.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(o){T.__e(o,t)}r.base=r.__P=r.__n=null}if(r=e.__k)for(i=0;i<r.length;i++)r[i]&&$t(r[i],t,n||typeof e.type!="function");n||it(e.__e),e.__c=e.__=e.__e=void 0}function Kn(e,t,n){return this.constructor(e,n)}function Yn(e,t,n){var r,i,o,s;t==document&&(t=document.documentElement),T.__&&T.__(e,t),i=(r=!1)?null:t.__k,o=[],s=[],ot(t,e=t.__k=jn(ae,null,[e]),i||Ne,Ne,t.namespaceURI,i?null:t.firstChild?Ie.call(t.childNodes):null,o,i?i.__e:t.firstChild,r,s),Pt(o,e,s),e.props.children=null}Ie=Oe.slice,T={__e:function(e,t,n,r){for(var i,o,s;t=t.__;)if((i=t.__c)&&!i.__)try{if((o=i.constructor)&&o.getDerivedStateFromError!=null&&(i.setState(o.getDerivedStateFromError(e)),s=i.__d),i.componentDidCatch!=null&&(i.componentDidCatch(e,r||{}),s=i.__d),s)return i.__E=i}catch(l){e=l}throw e}},kt=0,De.prototype.setState=function(e,t){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=ee({},this.state),typeof e=="function"&&(e=e(ee({},n),this.props)),e&&ee(n,e),e!=null&&this.__v&&(t&&this._sb.push(t),Ct(this))},De.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),Ct(this))},De.prototype.render=ae,oe=[],Et=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Tt=function(e,t){return e.__v.__b-t.__v.__b},$e.__r=0,et=Math.random().toString(8),Me="__d"+et,me="__a"+et,At=/(PointerCapture)$|Capture$/i,tt=0,nt=Ot(!1),rt=Ot(!0);var Jn=0;function u(e,t,n,r,i,o){t||(t={});var s,l,p=t;if("ref"in p)for(l in p={},t)l=="ref"?s=t[l]:p[l]=t[l];var c={type:e,props:p,key:n,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Jn,__i:-1,__u:0,__source:i,__self:o};if(typeof e=="function"&&(s=e.defaultProps))for(l in s)p[l]===void 0&&(p[l]=s[l]);return T.vnode&&T.vnode(c),c}var de,L,at,Ht,be=0,Ut=[],C=T,Gt=C.__b,qt=C.__r,Ft=C.diffed,jt=C.__c,zt=C.unmount,Bt=C.__;function Ue(e,t){C.__h&&C.__h(L,e,be||t),be=0;var n=L.__H||(L.__H={__:[],__h:[]});return e>=n.__.length&&n.__.push({}),n.__[e]}function M(e){return be=1,Vt(Kt,e)}function Vt(e,t,n){var r=Ue(de++,2);if(r.t=e,!r.__c&&(r.__=[Kt(void 0,t),function(l){var p=r.__N?r.__N[0]:r.__[0],c=r.t(p,l);p!==c&&(r.__N=[c,r.__[1]],r.__c.setState({}))}],r.__c=L,!L.__f)){var i=function(l,p,c){if(!r.__c.__H)return!0;var f=!1,h=r.__c.props!==l;if(r.__c.__H.__.some(function(g){if(g.__N){f=!0;var b=g.__[0];g.__=g.__N,g.__N=void 0,b!==g.__[0]&&(h=!0)}}),o){var a=o.call(this,l,p,c);return f?a||h:a}return!f||h};L.__f=!0;var o=L.shouldComponentUpdate,s=L.componentWillUpdate;L.componentWillUpdate=function(l,p,c){if(this.__e){var f=o;o=void 0,i(l,p,c),o=f}s&&s.call(this,l,p,c)},L.shouldComponentUpdate=i}return r.__N||r.__}function H(e,t){var n=Ue(de++,3);!C.__s&&ct(n.__H,t)&&(n.__=e,n.u=t,L.__H.__h.push(n))}function Xn(e,t){var n=Ue(de++,4);!C.__s&&ct(n.__H,t)&&(n.__=e,n.u=t,L.__h.push(n))}function O(e){return be=5,Ge(function(){return{current:e}},[])}function Ge(e,t){var n=Ue(de++,7);return ct(n.__H,t)&&(n.__=e(),n.__H=t,n.__h=e),n.__}function U(e,t){return be=8,Ge(function(){return e},t)}function Zn(){for(var e;e=Ut.shift();){var t=e.__H;if(e.__P&&t)try{t.__h.some(qe),t.__h.some(lt),t.__h=[]}catch(n){t.__h=[],C.__e(n,e.__v)}}}C.__b=function(e){L=null,Gt&&Gt(e)},C.__=function(e,t){e&&t.__k&&t.__k.__m&&(e.__m=t.__k.__m),Bt&&Bt(e,t)},C.__r=function(e){qt&&qt(e),de=0;var t=(L=e.__c).__H;t&&(at===L?(t.__h=[],L.__h=[],t.__.some(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0})):(t.__h.some(qe),t.__h.some(lt),t.__h=[],de=0)),at=L},C.diffed=function(e){Ft&&Ft(e);var t=e.__c;t&&t.__H&&(t.__H.__h.length&&(Ut.push(t)!==1&&Ht===C.requestAnimationFrame||((Ht=C.requestAnimationFrame)||Qn)(Zn)),t.__H.__.some(function(n){n.u&&(n.__H=n.u,n.u=void 0)})),at=L=null},C.__c=function(e,t){t.some(function(n){try{n.__h.some(qe),n.__h=n.__h.filter(function(r){return!r.__||lt(r)})}catch(r){t.some(function(i){i.__h&&(i.__h=[])}),t=[],C.__e(r,n.__v)}}),jt&&jt(e,t)},C.unmount=function(e){zt&&zt(e);var t,n=e.__c;n&&n.__H&&(n.__H.__.some(function(r){try{qe(r)}catch(i){t=i}}),n.__H=void 0,t&&C.__e(t,n.__v))};var Wt=typeof requestAnimationFrame=="function";function Qn(e){var t,n=function(){clearTimeout(r),Wt&&cancelAnimationFrame(t),setTimeout(e)},r=setTimeout(n,35);Wt&&(t=requestAnimationFrame(n))}function qe(e){var t=L,n=e.__c;typeof n=="function"&&(e.__c=void 0,n()),L=t}function lt(e){var t=L;e.__c=e.__(),L=t}function ct(e,t){return!e||e.length!==t.length||t.some(function(n,r){return n!==e[r]})}function Kt(e,t){return typeof t=="function"?t(e):t}const er=[["theme","dark","light","appearance","mode","colour","color"],["username","displayname","name","profile","account","handle"],["signout","logout","signin","login","session"],["billing","invoice","payment","plan","subscription"],["key","token","credential","secret","apikey"],["member","team","teammate","invite","organisation","organization","workspace"]];new Map(er.flatMap(e=>e.map(t=>[Yt(t),Yt(e[0])])));function Yt(e){let t=e;return t.length>4&&t.endsWith("ies")?`${t.slice(0,-3)}y`:(t.length>4&&t.endsWith("ing")?t=t.slice(0,-3):t.length>4&&t.endsWith("ed")||t.length>3&&t.endsWith("es")?t=t.slice(0,-2):t.length>3&&t.endsWith("s")&&(t=t.slice(0,-1)),t.length>4&&t.endsWith("e")&&(t=t.slice(0,-1)),t)}function tr(e){return e.length>=24?!0:/\d/.test(e)}function _e(e){let t;try{t=new URL(e,"http://site.invalid").pathname}catch{t=e.split(/[?#]/)[0]??"/"}const n=t.split("/").filter(r=>r!=="").map(r=>tr(decodeURIComponent(r))?":id":r);return n.length===0?"/":`/${n.join("/")}`}function nr(e,t){if(!e)return;const n=e.trim();if(!(n===""||/^(mailto:|tel:|javascript:|data:|#)/i.test(n)))try{const r=t?new URL(t):null,i=new URL(n,r??"http://site.invalid"),o=_e(i.toString());return!r||i.origin===r.origin||i.origin==="http://site.invalid"?o:`${i.origin}${o}`}catch{return}}function ut(e){return e.replace(/\s+/g," ").trim().toLowerCase()}function Fe(e){return[e.role.toLowerCase(),ut(e.name),e.landmark??"",e.href??""].join("|")}function ye(e,t){const n={role:e.role,name:e.name};e.landmark&&(n.landmark=e.landmark);const r=nr(e.href,t);return r&&(n.href=r),n}function rr(e,t){return!(e.role.toLowerCase()!==t.role.toLowerCase()||ut(e.name)!==ut(t.name)||e.href&&t.href&&e.href!==t.href||e.landmark&&t.landmark&&e.landmark!==t.landmark)}function ir(e=document){const t=e.documentElement?.getBoundingClientRect();return!!(t&&t.width+t.height>0)}function te(e){if(!e||!e.isConnected)return!1;const t=e.ownerDocument;if(!t||!ir(t))return!0;const n=e.getBoundingClientRect();if(n.width<=0||n.height<=0)return!1;const r=t.defaultView,i=r?.innerWidth??0,o=r?.innerHeight??0;return n.bottom>-o&&n.right>-i&&n.top<o*2&&n.left<i*2}let Jt=!1;const dt=new Set;function or(){if(!(Jt||typeof history>"u")){Jt=!0;for(const e of["pushState","replaceState"]){const t=history[e];history[e]=function(...r){const i=t.apply(this,r);for(const o of dt)o();return i}}}}function Xt(e){or();let t=location.href;const n=()=>{location.href!==t&&(t=location.href,e())};return dt.add(n),addEventListener("popstate",n),addEventListener("hashchange",n),()=>{dt.delete(n),removeEventListener("popstate",n),removeEventListener("hashchange",n)}}function sr(e,t=300,n=document.body){if(typeof MutationObserver>"u")return()=>{};let r;const i=new MutationObserver(()=>{r&&clearTimeout(r),r=setTimeout(e,t)});return i.observe(n,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style","hidden","aria-hidden"]}),()=>{r&&clearTimeout(r),i.disconnect()}}function Zt(e=300,t=1500,n=document.body){return new Promise(r=>{let i=!1,o,s;const l=typeof MutationObserver>"u"||!n?null:new MutationObserver(()=>c()),p=()=>{i||(i=!0,o&&clearTimeout(o),s&&clearTimeout(s),l?.disconnect(),r())},c=()=>{o&&clearTimeout(o),o=setTimeout(p,e)};l&&n&&(l.observe(n,{childList:!0,subtree:!0,attributes:!0}),s=setTimeout(p,t)),c()})}function ar(e,t=300){const n=Xt(()=>setTimeout(e,t)),r=sr(e,t);return()=>{n(),r()}}const lr=3,cr=8e3,ur=2500;class dr{constructor(t){this.deps=t,this.state="DONE",this.steps=[],this.index=0,this.scan=null,this.lookup=new Map,this.target=null,this.message=null,this.unwatch=null,this.replanning=!1,this.recoveries=0,this.binding=null,this.left=null,this.onUserEvent=n=>{if(this.state!=="SPOTLIGHTING"||!this.target)return;const r=this.steps[this.index];if(r&&pr(n,this.target)){if(n.type==="pointerdown"){if(r.advanceOn!=="click"&&r.advanceOn!=="navigation")return;this.enterVerifying();return}if(hr(r.advanceOn,n.type)){if(n.type==="keydown"){const i=n.key;if(i!=="Enter"&&i!==" "&&i!=="Spacebar")return}this.enterVerifying()}}},this.onPageChanged=()=>{if(this.state==="DONE"||this.state==="FAILED"||this.replanning)return;if(this.binding){this.binding.attempt();return}if(this.state!=="SPOTLIGHTING")return;const n=this.steps[this.index];if(!n||te(this.target))return;this.adoptScan(this.deps.rescan());const r=this.resolve(n);if(te(r)){this.target=r,this.transition("SPOTLIGHTING");return}this.recover()},this.doc=t.doc??document,this.settleMs=t.settleMs??300,this.bindTimeoutMs=t.bindTimeoutMs??null}get snapshot(){return{state:this.state,stepIndex:this.index,total:this.steps.length,step:this.steps[this.index]??null,target:this.target,message:this.message}}start(t,n){this.stopListening(),this.steps=n.map(r=>en(r,t)),this.index=0,this.message=null,this.recoveries=0,this.adoptScan(t);for(const r of["pointerdown","click","keydown","input","change"])this.doc.addEventListener(r,this.onUserEvent,!0);this.deps.watch&&(this.unwatch=this.deps.watch(this.onPageChanged)),this.enterSpotlight()}next(){this.state!=="SPOTLIGHTING"&&this.state!=="VERIFYING"||this.enterSnapshot()}lost(){this.state==="SPOTLIGHTING"&&this.recover()}stop(){this.stopListening(),this.target=null,this.transition("DONE")}dispose(){this.stopListening()}stopListening(){this.binding=null;for(const t of["pointerdown","click","keydown","input","change"])this.doc.removeEventListener(t,this.onUserEvent,!0);this.unwatch?.(),this.unwatch=null}adoptScan(t){this.scan=t,this.lookup=t.lookup}transition(t){this.state=t,this.deps.onChange(this.snapshot)}resolve(t){if(!this.scan)return null;const n=fr(this.scan,t,t.target);if(n)return t.target=n,this.lookup.get(n)??null;if(t.control)return null;const r=t.target?this.lookup.get(t.target)??null:null;return te(r)?r:null}enterSpotlight(t=null){this.binding=null;const n=this.steps[this.index];if(!n){this.stopListening(),this.target=null,this.transition("DONE");return}const r=this.resolve(n);if(!te(r)){this.target=null,this.recover();return}this.target=r,this.message=t,this.recoveries=0,this.transition("SPOTLIGHTING")}enterVerifying(){this.left={href:this.href(),signature:this.scan?Qt(this.scan):""},this.target=null,this.transition("VERIFYING"),this.settle().then(()=>{this.state==="VERIFYING"&&this.enterSnapshot()})}href(){return this.doc.defaultView?.location?.href??""}settle(){return this.deps.settle?this.deps.settle():Zt(this.settleMs,1500,this.doc.body)}async enterSnapshot(){const t=this.steps[this.index];if(this.target=null,this.transition("SNAPSHOTTING"),this.index+=1,this.index>=this.steps.length){this.stopListening(),this.transition("DONE");return}const n=t?.advanceOn==="navigation";await this.bindNext(n?cr:ur,n)}arrived(t){const n=this.left;return n?this.href()===n.href?!1:Qt(t)!==n.signature:!0}bindNext(t,n){return new Promise(r=>{const i=this.bindTimeoutMs??t;let o;const s=()=>{o&&clearTimeout(o),this.binding=null,r()},l=()=>{const p=this.steps[this.index];if(!p)return!0;const c=this.deps.rescan();if(n&&!this.arrived(c))return!1;this.adoptScan(c);const f=this.resolve(p);return te(f)?(this.enterSpotlight(),!0):!1};if(l()){s();return}this.binding={attempt:()=>{l()&&s()}},o=setTimeout(()=>{this.binding!==null&&(this.binding=null,this.settle().then(()=>{if(this.state!=="SNAPSHOTTING"){r();return}if(l()){r();return}this.recover().then(r,r)}))},i)})}async recover(){if(!this.replanning){if(this.recoveries>=lr){this.message="That control is no longer on the page.",this.stopListening(),this.target=null,this.transition("FAILED");return}this.recoveries+=1,this.replanning=!0,this.target=null,this.binding=null,this.transition("SNAPSHOTTING");try{await this.settle();const t=this.steps[this.index];this.adoptScan(this.deps.rescan());const n=t?this.resolve(t):null;if(te(n)){this.replanning=!1,this.enterSpotlight();return}const r=this.steps.length,i=await this.deps.replan(this.index);if(!i||i.steps.length===0){this.message="That control is no longer on the page.",this.stopListening(),this.transition("FAILED");return}this.steps=[...this.steps.slice(0,this.index),...i.steps.map(l=>en(l,i))],this.adoptScan(i),this.replanning=!1;const o=i.routeChanged===!0||this.steps.length!==r,s=this.steps.length-this.index;this.enterSpotlight(o?`The route changed: ${s} step${s===1?"":"s"} to go.`:null)}catch{this.message="Guidance stopped because the page changed.",this.stopListening(),this.transition("FAILED")}finally{this.replanning=!1}}}}function pr(e,t){return(typeof e.composedPath=="function"?e.composedPath():[]).includes(t)?!0:e.target instanceof Node&&t.contains(e.target)}function hr(e,t){switch(e){case"click":return t==="click"||t==="keydown";case"input":return t==="input"||t==="change";case"navigation":return t==="click"||t==="keydown";case"manual":return!1}}function Qt(e){const t=e.page.affordances.map(n=>Fe(ye(n,e.page.url)));return`${e.page.title}
${t.sort().join(`
`)}`}function en(e,t){const n={...e};if(n.control||!n.target)return n;const r=t.page.affordances.find(i=>i.id===n.target);return r&&(n.control={...ye(r,t.page.url),route:_e(t.page.url)}),n}function fr(e,t,n=null){const r=t.control??null;if(!r||!r.name.trim())return null;const i=Fe(r);let o=null,s=null;for(const l of e.page.affordances){const p=ye(l,e.page.url);if(rr(p,r)&&te(e.lookup.get(l.id)))if(Fe(p)===i){if(l.id===n)return l.id;o===null&&(o=l.id)}else s===null&&(s=l.id)}return o??s}const je=8,gr=12,mr=260,tn=14;class br{constructor(t,n){this.host=t,this.handlers=n,this.view=null,this.frame=0,this.open=!1,this.resizeObserver=null,this.mutationObserver=null,this.schedule=()=>{this.frame||(this.frame=requestAnimationFrame(()=>{this.frame=0,this.reposition()}))};const{root:r,hole:i,ring:o,bubble:s,counter:l,text:p,advance:c,stop:f}=_r();this.root=r,this.hole=i,this.ring=o,this.bubble=s,this.counter=l,this.text=p,this.advance=c,this.stop=f,this.advance.addEventListener("click",()=>{this.view&&(this.view.isLast?this.handlers.onDone():this.handlers.onNext())}),this.stop.addEventListener("click",()=>this.handlers.onStop()),this.host.appendChild(this.root)}show(t){if(!te(t.target)){this.hide(),this.handlers.onLost?.();return}const n=t.target.getBoundingClientRect();(n.top<8||n.left<8||n.bottom>window.innerHeight-8||n.right>window.innerWidth-8)&&t.target.scrollIntoView({block:"center",inline:"center",behavior:"auto"});const i=this.view?.target??null;this.view=t,this.counter.textContent=`Step ${t.index+1} of ${t.total}`,this.root.dataset.plStep=String(t.index+1),this.root.dataset.plTotal=String(t.total),this.text.textContent=t.caption,this.advance.textContent=t.isLast?"Done":"Next",this.advance.hidden=!0,this.root.classList.toggle("pl-spot--busy",!!t.busy),this.open||(this.open=!0,yr(this.root),addEventListener("scroll",this.schedule,!0),addEventListener("resize",this.schedule),this.watchLayout()),i!==t.target&&this.follow(t.target),this.reposition()}follow(t){this.resizeObserver?.disconnect(),this.resizeObserver=null,!(typeof ResizeObserver>"u")&&(this.resizeObserver=new ResizeObserver(()=>this.schedule()),this.resizeObserver.observe(t))}watchLayout(){typeof MutationObserver>"u"||!document.body||(this.mutationObserver=new MutationObserver(()=>this.schedule()),this.mutationObserver.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style","hidden","aria-hidden","open"]}))}hide(){this.view=null,this.resizeObserver?.disconnect(),this.resizeObserver=null,this.mutationObserver?.disconnect(),this.mutationObserver=null,delete this.root.dataset.plStep,delete this.root.dataset.plTotal,this.open&&(this.open=!1,vr(this.root),removeEventListener("scroll",this.schedule,!0),removeEventListener("resize",this.schedule),this.frame&&cancelAnimationFrame(this.frame),this.frame=0)}destroy(){this.hide(),this.root.remove()}reposition(){if(!this.view)return;if(!te(this.view.target)){this.hide(),this.handlers.onLost?.();return}const t=this.view.target.getBoundingClientRect(),n=innerWidth,r=innerHeight,i=Math.max(t.left-je,4),o=Math.max(t.top-je,4),s=Math.max(t.width+je*2,12),l=Math.max(t.height+je*2,12);for(const g of[this.hole,this.ring])g.setAttribute("x",String(i)),g.setAttribute("y",String(o)),g.setAttribute("width",String(Math.min(s,n-i-4))),g.setAttribute("height",String(Math.min(l,r-o-4))),g.setAttribute("rx",String(gr));const p=o+l+tn,c=this.bubble.offsetHeight||120,f=p+c<r,h=f?p:Math.max(o-tn-c,8),a=Math.min(Math.max(i,8),Math.max(n-mr-8,8));this.bubble.dataset.side=f?"below":"above",this.bubble.style.transform=`translate(${Math.round(a)}px, ${Math.round(h)}px)`}}function _r(){const e=document.createElement("div");e.className="pl-spot",e.setAttribute("popover","manual");const t=document.createElementNS("http://www.w3.org/2000/svg","svg");t.setAttribute("class","pl-spot__svg"),t.setAttribute("aria-hidden","true");const n=document.createElementNS("http://www.w3.org/2000/svg","defs"),r=document.createElementNS("http://www.w3.org/2000/svg","mask");r.setAttribute("id","pl-spot-mask");const i=document.createElementNS("http://www.w3.org/2000/svg","rect");i.setAttribute("width","100%"),i.setAttribute("height","100%"),i.setAttribute("fill","white");const o=document.createElementNS("http://www.w3.org/2000/svg","rect");o.setAttribute("fill","black"),r.append(i,o),n.append(r);const s=document.createElementNS("http://www.w3.org/2000/svg","rect");s.setAttribute("class","pl-spot__scrim"),s.setAttribute("width","100%"),s.setAttribute("height","100%"),s.setAttribute("mask","url(#pl-spot-mask)");const l=document.createElementNS("http://www.w3.org/2000/svg","rect");l.setAttribute("class","pl-spot__ring"),t.append(n,s,l);const p=document.createElement("div");p.className="pl-spot__bubble";const c=document.createElement("span");c.className="pl-spot__counter";const f=document.createElement("p");f.className="pl-spot__caption";const h=document.createElement("div");h.className="pl-spot__actions";const a=document.createElement("button");a.type="button",a.className="pl-btn pl-btn--quiet",a.textContent="Skip";const g=document.createElement("button");return g.type="button",g.className="pl-btn pl-btn--accent",g.textContent="Next",g.hidden=!0,h.append(a,g),p.append(c,f,h),e.append(t,p),{root:e,hole:o,ring:l,bubble:p,counter:c,text:f,advance:g,stop:a}}function yr(e){const t=e;if(typeof t.showPopover=="function")try{t.showPopover();return}catch{}e.classList.add("pl-spot--fallback")}function vr(e){const t=e;if(typeof t.hidePopover=="function")try{t.hidePopover()}catch{}e.classList.remove("pl-spot--fallback")}var wr=Object.prototype.toString;function xr(e){return typeof e=="function"||wr.call(e)==="[object Function]"}function kr(e){var t=Number(e);return isNaN(t)?0:t===0||!isFinite(t)?t:(t>0?1:-1)*Math.floor(Math.abs(t))}var Sr=Math.pow(2,53)-1;function Er(e){var t=kr(e);return Math.min(Math.max(t,0),Sr)}function K(e,t){var n=Array,r=Object(e);if(e==null)throw new TypeError("Array.from requires an array-like object - not null or undefined");for(var i=Er(r.length),o=xr(n)?Object(new n(i)):new Array(i),s=0,l;s<i;)l=r[s],o[s]=l,s+=1;return o.length=i,o}function ve(e){"@babel/helpers - typeof";return ve=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(t){return typeof t}:function(t){return t&&typeof Symbol=="function"&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ve(e)}function Tr(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function Ar(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(e,nn(r.key),r)}}function Lr(e,t,n){return t&&Ar(e.prototype,t),Object.defineProperty(e,"prototype",{writable:!1}),e}function Cr(e,t,n){return t=nn(t),t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function nn(e){var t=Ir(e,"string");return ve(t)=="symbol"?t:t+""}function Ir(e,t){if(ve(e)!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t);if(ve(r)!="object")return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)}var Mr=(function(){function e(){var t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:[];Tr(this,e),Cr(this,"items",void 0),this.items=t}return Lr(e,[{key:"add",value:function(n){return this.has(n)===!1&&this.items.push(n),this}},{key:"clear",value:function(){this.items=[]}},{key:"delete",value:function(n){var r=this.items.length;return this.items=this.items.filter(function(i){return i!==n}),r!==this.items.length}},{key:"forEach",value:function(n){var r=this;this.items.forEach(function(i){n(i,i,r)})}},{key:"has",value:function(n){return this.items.indexOf(n)!==-1}},{key:"size",get:function(){return this.items.length}}])})();const Nr=typeof Set>"u"?Set:Mr;function D(e){var t;return(t=e.localName)!==null&&t!==void 0?t:e.tagName.toLowerCase()}var Or={article:"article",aside:"complementary",button:"button",datalist:"listbox",dd:"definition",details:"group",dialog:"dialog",dt:"term",fieldset:"group",figure:"figure",form:"form",footer:"contentinfo",h1:"heading",h2:"heading",h3:"heading",h4:"heading",h5:"heading",h6:"heading",header:"banner",hr:"separator",html:"document",legend:"legend",li:"listitem",math:"math",main:"main",menu:"list",nav:"navigation",ol:"list",optgroup:"group",option:"option",output:"status",progress:"progressbar",section:"region",summary:"button",table:"table",tbody:"rowgroup",textarea:"textbox",tfoot:"rowgroup",td:"cell",th:"columnheader",thead:"rowgroup",tr:"row",ul:"list"},Rr={caption:new Set(["aria-label","aria-labelledby"]),code:new Set(["aria-label","aria-labelledby"]),deletion:new Set(["aria-label","aria-labelledby"]),emphasis:new Set(["aria-label","aria-labelledby"]),generic:new Set(["aria-label","aria-labelledby","aria-roledescription"]),insertion:new Set(["aria-label","aria-labelledby"]),none:new Set(["aria-label","aria-labelledby"]),paragraph:new Set(["aria-label","aria-labelledby"]),presentation:new Set(["aria-label","aria-labelledby"]),strong:new Set(["aria-label","aria-labelledby"]),subscript:new Set(["aria-label","aria-labelledby"]),superscript:new Set(["aria-label","aria-labelledby"])};function Pr(e,t){return["aria-atomic","aria-busy","aria-controls","aria-current","aria-description","aria-describedby","aria-details","aria-dropeffect","aria-flowto","aria-grabbed","aria-hidden","aria-keyshortcuts","aria-label","aria-labelledby","aria-live","aria-owns","aria-relevant","aria-roledescription"].some(function(n){var r;return e.hasAttribute(n)&&!((r=Rr[t])!==null&&r!==void 0&&r.has(n))})}function rn(e,t){return Pr(e,t)}function Dr(e){var t=Hr(e);if(t===null||pt.indexOf(t)!==-1){var n=$r(e);if(pt.indexOf(t||"")===-1||rn(e,n||""))return n}return t}function $r(e){var t=Or[D(e)];if(t!==void 0)return t;switch(D(e)){case"a":case"area":case"link":if(e.hasAttribute("href"))return"link";break;case"img":return e.getAttribute("alt")===""&&!rn(e,"img")?"presentation":"img";case"input":{var n=e,r=n.type;switch(r){case"button":case"image":case"reset":case"submit":return"button";case"checkbox":case"radio":return r;case"range":return"slider";case"email":case"tel":case"text":case"url":return e.hasAttribute("list")?"combobox":"textbox";case"search":return e.hasAttribute("list")?"combobox":"searchbox";case"number":return"spinbutton";default:return null}}case"select":return e.hasAttribute("multiple")||e.size>1?"listbox":"combobox"}return null}function Hr(e){var t=e.getAttribute("role");if(t!==null){var n=t.trim().split(" ")[0];if(n.length>0)return n}return null}var pt=["presentation","none"];function A(e){return e!==null&&e.nodeType===e.ELEMENT_NODE}function on(e){return A(e)&&D(e)==="caption"}function ze(e){return A(e)&&D(e)==="input"}function Ur(e){return A(e)&&D(e)==="optgroup"}function Gr(e){return A(e)&&D(e)==="select"}function qr(e){return A(e)&&D(e)==="table"}function Fr(e){return A(e)&&D(e)==="textarea"}function jr(e){var t=e.ownerDocument===null?e:e.ownerDocument,n=t.defaultView;if(n===null)throw new TypeError("no window available");return n}function zr(e){return A(e)&&D(e)==="fieldset"}function Br(e){return A(e)&&D(e)==="legend"}function Vr(e){return A(e)&&D(e)==="slot"}function Wr(e){return A(e)&&e.ownerSVGElement!==void 0}function Kr(e){return A(e)&&D(e)==="svg"}function Yr(e){return Wr(e)&&D(e)==="title"}function ht(e,t){if(A(e)&&e.hasAttribute(t)){var n=e.getAttribute(t).split(" "),r=e.getRootNode?e.getRootNode():e.ownerDocument;return n.map(function(i){return r.getElementById(i)}).filter(function(i){return i!==null})}return[]}function ne(e,t){return A(e)?t.indexOf(Dr(e))!==-1:!1}function Jr(e){return e.trim().replace(/\s\s+/g," ")}function Xr(e,t){if(!A(e))return!1;if(e.hasAttribute("hidden")||e.getAttribute("aria-hidden")==="true")return!0;var n=t(e);return n.getPropertyValue("display")==="none"||n.getPropertyValue("visibility")==="hidden"}function Zr(e){return ne(e,["button","combobox","listbox","textbox"])||sn(e,"range")}function sn(e,t){if(!A(e))return!1;switch(t){case"range":return ne(e,["meter","progressbar","scrollbar","slider","spinbutton"]);default:throw new TypeError("No knowledge about abstract role '".concat(t,"'. This is likely a bug :("))}}function an(e,t){var n=K(e.querySelectorAll(t));return ht(e,"aria-owns").forEach(function(r){n.push.apply(n,K(r.querySelectorAll(t)))}),n}function Qr(e){return Gr(e)?e.selectedOptions||an(e,"[selected]"):an(e,'[aria-selected="true"]')}function ei(e){return ne(e,pt)}function ti(e){return on(e)}function ni(e){return ne(e,["button","cell","checkbox","columnheader","gridcell","heading","label","legend","link","menuitem","menuitemcheckbox","menuitemradio","option","radio","row","rowheader","switch","tab","tooltip","treeitem"])}function ri(e){return!1}function ii(e){return ze(e)||Fr(e)?e.value:e.textContent||""}function ln(e){var t=e.getPropertyValue("content");return/^["'].*["']$/.test(t)?t.slice(1,-1):""}function cn(e){var t=D(e);return t==="button"||t==="input"&&e.getAttribute("type")!=="hidden"||t==="meter"||t==="output"||t==="progress"||t==="select"||t==="textarea"}function un(e){if(cn(e))return e;var t=null;return e.childNodes.forEach(function(n){if(t===null&&A(n)){var r=un(n);r!==null&&(t=r)}}),t}function oi(e){if(e.control!==void 0)return e.control;var t=e.getAttribute("for");return t!==null?e.ownerDocument.getElementById(t):un(e)}function si(e){var t=e.labels;if(t===null)return t;if(t!==void 0)return K(t);if(!cn(e))return null;var n=e.ownerDocument;return K(n.querySelectorAll("label")).filter(function(r){return oi(r)===e})}function ai(e){var t=e.assignedNodes();return t.length===0?K(e.childNodes):t}function li(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=new Nr,r=typeof Map>"u"?void 0:new Map,i=jr(e),o=t.compute,s=o===void 0?"name":o,l=t.computedStyleSupportsPseudoElements,p=l===void 0?t.getComputedStyle!==void 0:l,c=t.getComputedStyle,f=c===void 0?i.getComputedStyle.bind(i):c,h=t.hidden,a=h===void 0?!1:h,g=function(k,x){if(x!==void 0)throw new Error("use uncachedGetComputedStyle directly for pseudo elements");if(r===void 0)return f(k);var R=r.get(k);if(R)return R;var G=f(k,x);return r.set(k,G),G};function b(d,k){var x="";if(A(d)&&p){var R=f(d,"::before"),G=ln(R);x="".concat(G," ").concat(x)}var $=Vr(d)?ai(d):K(d.childNodes).concat(ht(d,"aria-owns"));if($.forEach(function(N){var Z=_(N,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!1,recursion:!0}),q=A(N)?g(N).getPropertyValue("display"):"inline",re=q!=="inline"?" ":"";x+="".concat(re).concat(Z).concat(re)}),A(d)&&p){var F=f(d,"::after"),I=ln(F);x="".concat(x," ").concat(I)}return x.trim()}function w(d,k){var x=d.getAttributeNode(k);return x!==null&&!n.has(x)&&x.value.trim()!==""?(n.add(x),x.value):null}function v(d){return A(d)?w(d,"title"):null}function E(d){if(!A(d))return null;if(zr(d)){n.add(d);for(var k=K(d.childNodes),x=0;x<k.length;x+=1){var R=k[x];if(Br(R))return _(R,{isEmbeddedInLabel:!1,isReferenced:!1,recursion:!1})}}else if(qr(d)){n.add(d);for(var G=K(d.childNodes),$=0;$<G.length;$+=1){var F=G[$];if(on(F))return _(F,{isEmbeddedInLabel:!1,isReferenced:!1,recursion:!1})}}else if(Kr(d)){n.add(d);for(var I=K(d.childNodes),N=0;N<I.length;N+=1){var Z=I[N];if(Yr(Z))return Z.textContent}return null}else if(D(d)==="img"||D(d)==="area"){var q=w(d,"alt");if(q!==null)return q}else if(Ur(d)){var re=w(d,"label");if(re!==null)return re}if(ze(d)&&(d.type==="button"||d.type==="submit"||d.type==="reset")){var ke=w(d,"value");if(ke!==null)return ke;if(d.type==="submit")return"Submit";if(d.type==="reset")return"Reset"}var he=si(d);if(he!==null&&he.length!==0)return n.add(d),K(he).map(function(fe){return _(fe,{isEmbeddedInLabel:!0,isReferenced:!1,recursion:!0})}).filter(function(fe){return fe.length>0}).join(" ");if(ze(d)&&d.type==="image"){var Ke=w(d,"alt");if(Ke!==null)return Ke;var Se=w(d,"title");return Se!==null?Se:"Submit Query"}if(ne(d,["button"])){var Ye=b(d,{isEmbeddedInLabel:!1});if(Ye!=="")return Ye}return null}function _(d,k){if(n.has(d))return"";if(!a&&Xr(d,g)&&!k.isReferenced)return n.add(d),"";var x=A(d)?d.getAttributeNode("aria-labelledby"):null,R=x!==null&&!n.has(x)?ht(d,"aria-labelledby"):[];if(s==="name"&&!k.isReferenced&&R.length>0)return n.add(x),R.map(function(q){return _(q,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!0,recursion:!1})}).join(" ");var G=k.recursion&&Zr(d)&&s==="name";if(!G){var $=(A(d)&&d.getAttribute("aria-label")||"").trim();if($!==""&&s==="name")return n.add(d),$;if(!ei(d)){var F=E(d);if(F!==null)return n.add(d),F}}if(ne(d,["menu"]))return n.add(d),"";if(G||k.isEmbeddedInLabel||k.isReferenced){if(ne(d,["combobox","listbox"])){n.add(d);var I=Qr(d);return I.length===0?ze(d)?d.value:"":K(I).map(function(q){return _(q,{isEmbeddedInLabel:k.isEmbeddedInLabel,isReferenced:!1,recursion:!0})}).join(" ")}if(sn(d,"range"))return n.add(d),d.hasAttribute("aria-valuetext")?d.getAttribute("aria-valuetext"):d.hasAttribute("aria-valuenow")?d.getAttribute("aria-valuenow"):d.getAttribute("value")||"";if(ne(d,["textbox"]))return n.add(d),ii(d)}if(ni(d)||A(d)&&k.isReferenced||ti(d)||ri()){var N=b(d,{isEmbeddedInLabel:k.isEmbeddedInLabel});if(N!=="")return n.add(d),N}if(d.nodeType===d.TEXT_NODE)return n.add(d),d.textContent||"";if(k.recursion)return n.add(d),b(d,{isEmbeddedInLabel:k.isEmbeddedInLabel});var Z=v(d);return Z!==null?(n.add(d),Z):(n.add(d),"")}return Jr(_(e,{isEmbeddedInLabel:!1,isReferenced:s==="description",recursion:!1}))}function ci(e){return ne(e,["caption","code","deletion","emphasis","generic","insertion","none","paragraph","presentation","strong","subscript","superscript"])}function ui(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return ci(e)?"":li(e,t)}const di=new Set(["a","an","and","are","be","can","do","does","for","from","how","i","in","is","it","me","my","of","on","or","the","this","to","up","what","where","with","you","your"]),pi=new Set(["ok","go","close","open","menu","more","link","button","submit","click here","here","next","previous","back","toggle","dismiss","x"]),hi={dialog:3,sidebar:2,header:2,navigation:2,main:1},fi={theme:["dark","light","appearance","mode"],dark:["theme","appearance","night"],username:["name","handle","profile","account","display"],profile:["account","username","settings"],account:["profile","user","settings"],password:["security","credentials"],billing:["payment","invoice","plan"],key:["keys","token","api"]};function dn(e){return e.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>1&&!di.has(t)).map(pn)}function pn(e){return e.length>4&&e.endsWith("ies")?`${e.slice(0,-3)}y`:e.length>3&&e.endsWith("es")&&!e.endsWith("ses")?e.slice(0,-2):e.length>3&&e.endsWith("s")&&!e.endsWith("ss")?e.slice(0,-1):e.length>5&&e.endsWith("ing")?e.slice(0,-3):e}function gi(e){const t=new Set(dn(e));for(const n of[...t])for(const r of fi[n]??[])t.add(pn(r));return t}function mi(e,t){let n=e.visible?4:0;n+=hi[e.landmark??""]??0,e.disabled&&(n-=2);const r=dn([e.name,e.text??"",e.href??""].join(" "));r.length===0&&(n-=3);let i=0;for(const s of new Set(r))t.has(s)&&(i+=1);n+=i*6;const o=e.name.trim().toLowerCase();return o?pi.has(o)&&(n-=2):n-=4,n}function bi(e,t,n){const r=gi(t);return e.map((i,o)=>({candidate:i,index:o,score:mi(i,r)})).sort((i,o)=>o.score-i.score||i.index-o.index).slice(0,n).sort((i,o)=>i.index-o.index).map(i=>i.candidate)}const _i=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","SVG","IFRAME","CANVAS"]),yi=2e3;function vi(e){if(e.hasAttribute("hidden")||e.getAttribute("aria-hidden")==="true")return!0;const t=e.ownerDocument.defaultView;if(!t)return!1;try{const n=t.getComputedStyle(e);return n.display==="none"||n.visibility==="hidden"}catch{return!1}}function wi(e,t=null,n=yi){if(!e)return"";const r=[];let i=0;const o=s=>{if(i>=n)return;if(s.nodeType===3){const p=(s.nodeValue??"").replace(/\s+/g," ").trim();if(!p)return;r.push(p),i+=p.length+1;return}if(s.nodeType!==1)return;const l=s;if(!(l===t||_i.has(l.tagName)||vi(l)))for(const p of Array.from(l.childNodes))o(p)};return o(e),r.join(" ").slice(0,n)}const hn=["button","a[href]",'input:not([type="hidden"])',"select","textarea","summary",'[role="button"]','[role="link"]','[role="tab"]','[role="menuitem"]','[role="menuitemcheckbox"]','[role="checkbox"]','[role="radio"]','[role="switch"]','[role="combobox"]','[role="option"]','[tabindex]:not([tabindex="-1"])','[contenteditable=""]','[contenteditable="true"]'].join(","),xi=150;function Be(e={}){const t=e.root??document,n=e.question??"",r=e.limit??xi,i=[],o=new Set;ki(t.body??t.documentElement,i,o,e.exclude??null);const s=bi(i,n,r),l=new Map,p=s.map((c,f)=>{const h=`a${f+1}`;l.set(h,c.element);const a={id:h,role:c.role,name:c.name,visible:c.visible};return c.text&&c.text!==c.name&&(a.text=c.text),c.landmark&&(a.landmark=c.landmark),c.href&&(a.href=c.href),c.disabled&&(a.disabled=!0),c.state&&(a.state=c.state),a});return{page:{url:t.defaultView?.location?.href??"",title:t.title??"",affordances:p,text:wi(t.body??t.documentElement,e.exclude??null)},lookup:l}}function ki(e,t,n,r){if(!e)return;const i=[e];for(;i.length;){const o=i.shift();if(r&&(o===r||r.contains(o)))continue;o!==e&&!n.has(o)&&Si(o,hn)&&(n.add(o),t.push(fn(o)));for(const l of Array.from(o.children))i.push(l);const s=o.shadowRoot;if(s&&s.mode==="open")for(const l of Array.from(s.children))i.push(l)}}function Si(e,t){try{return e.matches(t)}catch{return!1}}function Ei(e){const t=fn(e),n={id:"",role:t.role,name:t.name,visible:t.visible};return t.text&&t.text!==t.name&&(n.text=t.text),t.landmark&&(n.landmark=t.landmark),t.href&&(n.href=t.href),t.disabled&&(n.disabled=!0),t.state&&(n.state=t.state),n}function fn(e){const t=Li(e),n=(e.textContent??"").replace(/\s+/g," ").trim().slice(0,120),r=e instanceof HTMLAnchorElement?e.getAttribute("href")??void 0:void 0;return{element:e,role:Ii(e),name:t,text:n||void 0,landmark:Mi(e),href:r,visible:Oi(e),disabled:Ni(e),state:Ti(e)}}function Ti(e){const t=[];return(e.getAttribute("aria-selected")==="true"||e.getAttribute("aria-current")==="page")&&t.push("selected"),e.getAttribute("aria-expanded")==="true"&&t.push("expanded"),(e.getAttribute("aria-checked")??(Ai(e)?"true":null))==="true"&&t.push("checked"),t.length?t.join(", "):void 0}function Ai(e){return e instanceof HTMLInputElement&&(e.type==="checkbox"||e.type==="radio")?e.checked:!1}function Li(e){try{const n=ui(e).replace(/\s+/g," ").trim();if(n)return n}catch{}return(e.getAttribute("aria-label")??e.getAttribute("title")??e.getAttribute("placeholder")??e.getAttribute("value")??e.textContent??"").replace(/\s+/g," ").trim().slice(0,120)}const Ci={checkbox:"checkbox",radio:"radio",range:"slider",button:"button",submit:"button",reset:"button",search:"searchbox",email:"textbox",tel:"textbox",url:"textbox",number:"spinbutton",password:"textbox",text:"textbox"};function Ii(e){const t=e.getAttribute("role");if(t)return t.trim().split(/\s+/)[0];switch(e.tagName.toLowerCase()){case"a":return e.hasAttribute("href")?"link":"generic";case"button":return"button";case"select":return"combobox";case"textarea":return"textbox";case"summary":return"button";case"input":{const r=(e.getAttribute("type")??"text").toLowerCase();return Ci[r]??"textbox"}default:return e.getAttribute("contenteditable")!==null?"textbox":"button"}}const gn={nav:"sidebar",header:"header",main:"main",aside:"sidebar",footer:"footer",dialog:"dialog",form:"form"},mn={navigation:"sidebar",banner:"header",main:"main",complementary:"sidebar",contentinfo:"footer",dialog:"dialog",alertdialog:"dialog",menu:"menu",form:"form",search:"search"};function Mi(e){let t=e;for(;t&&t!==t.ownerDocument?.body;){const n=t.getAttribute("role");if(n&&mn[n])return mn[n];const r=t.tagName.toLowerCase();if(gn[r])return gn[r];const i=t.getAttribute("aria-label");if(i&&t.hasAttribute("data-region"))return i.toLowerCase();t=t.parentElement??t.getRootNode().host??null}}function Ni(e){return e.getAttribute("aria-disabled")==="true"?!0:"disabled"in e&&!!e.disabled}function Oi(e){if(e.closest('[aria-hidden="true"],[hidden],[inert]'))return!1;const t=e.ownerDocument?.defaultView,n=t?.getComputedStyle(e);if(n&&(n.display==="none"||n.visibility==="hidden"||n.visibility==="collapse"||n.opacity==="0"))return!1;const r=e.getBoundingClientRect();if(!(typeof t?.innerWidth=="number"&&r.width+r.height>0))return Ri(e);if(r.width===0||r.height===0)return!1;const o=t?.innerWidth??0,s=t?.innerHeight??0;return r.bottom<=0||r.right<=0||r.top>=s||r.left>=o?!1:Pi(e,r,o,s)}function Ri(e){let t=e;const n=e.ownerDocument?.defaultView;for(;t;){const r=n?.getComputedStyle(t);if(r&&(r.display==="none"||r.visibility==="hidden"))return!1;t=t.parentElement}return!0}function Pi(e,t,n,r){const i=e.ownerDocument;if(!i||typeof i.elementFromPoint!="function")return!0;const o=Math.min(Math.max(t.left+t.width/2,1),n-1),s=Math.min(Math.max(t.top+t.height/2,1),r-1),l=Di(i,o,s);return l?l===e||e.contains(l)||l.contains(e):!1}function Di(e,t,n){let r=e.elementFromPoint(t,n);for(;r;){const i=r.shadowRoot;if(!i)return r;const o=i.elementFromPoint?.(t,n);if(!o||o===r)return r;r=o}return r}const ft="lantern:press",bn="lantern:seen",$i=1e4,Hi=400,Ui=8e3,Gi=150;function gt(e){const t=e.page.affordances.map(n=>Fe(ye(n,e.page.url)));return`${e.page.title}
${t.sort().join(`
`)}`}function _n(e){try{return sessionStorage.getItem(e)}catch{return null}}function mt(e,t){try{t===null?sessionStorage.removeItem(e):sessionStorage.setItem(e,t)}catch{}}function qi(){const e=_n(ft);if(!e)return null;try{const t=JSON.parse(e);return typeof t.fromUrl!="string"||typeof t.at!="number"?null:t}catch{return null}}function Fi(){const e=_n(bn);if(!e)return new Set;try{const t=JSON.parse(e);return new Set(Array.isArray(t)?t.filter(n=>typeof n=="string"):[])}catch{return new Set}}function ji(e,t){const n=Fi();let r=!1;const i=h=>{n.add(h),mt(bn,JSON.stringify([...n]))},o=async h=>{const a=Date.now()+Ui;for(;;){if(await Zt(Hi,2e3,document.body),r)return null;const g=Be({exclude:t});if(h===null||gt(g)!==h)return g;if(Date.now()>a)return null;await new Promise(b=>setTimeout(b,Gi))}},s=async(h,a)=>{const g=await o(a);if(!g)return;const{page:b}=g,w=_e(b.url),v=!n.has(`page|${w}`);let E;if(h&&_e(h.fromUrl)!==w){const _=`move|${_e(h.fromUrl)}|${h.control.role}|${h.control.name.toLowerCase()}|${w}`;n.has(_)||(E=h,i(_))}!v&&!E||(v&&i(`page|${w}`),await e.observe(E?{page:b,transition:E}:{page:b}))},l=h=>{const a=h.target instanceof Element?h.target:null;if(!a||t&&t.contains(a)||h.type==="keydown"&&h.key!=="Enter")return;const g=a.closest(hn);if(!g)return;const b=Ei(g);if(!b.name.trim())return;const w={fromUrl:location.href,fromTitle:document.title,control:ye(b,location.href),at:Date.now()};mt(ft,JSON.stringify(w))};document.addEventListener("pointerdown",l,!0),document.addEventListener("keydown",l,!0);const p=()=>{const h=qi();if(h&&(mt(ft,null),!(Date.now()-h.at>$i)&&h.fromUrl!==location.href))return{fromUrl:h.fromUrl,fromTitle:h.fromTitle,control:h.control}};let c=gt(Be({exclude:t}));const f=Xt(()=>{const h=c;s(p(),h).catch(()=>{}).finally(()=>{r||(c=gt(Be({exclude:t})))})});return s(p(),null).catch(()=>{}),{dispose:()=>{r=!0,document.removeEventListener("pointerdown",l,!0),document.removeEventListener("keydown",l,!0),f()}}}class zi{constructor(t,n=()=>{}){this.onStateChange=t,this.onFinished=n,this.audio=null,this.abort=null,this.objectUrl=null,this.token=0}get speaking(){return!!(this.audio&&!this.audio.paused&&!this.audio.ended)}async play(t){this.stop();const n=this.token+=1,r=()=>{n===this.token&&(this.token+=1,this.onFinished())},i=new AbortController;this.abort=i;try{const o=await t(i.signal);if(!o.body){r();return}const s=new Audio;this.audio=s,s.addEventListener("ended",()=>{this.onStateChange(!1),r()}),s.addEventListener("error",()=>r()),s.addEventListener("pause",()=>this.onStateChange(this.speaking)),Bi()?await this.playStreaming(s,o.body,i.signal,r):await this.playBuffered(s,o,r),this.onStateChange(!0)}catch(o){o?.name!=="AbortError"&&(this.onStateChange(!1),r())}}stop(){this.token+=1,this.abort?.abort(),this.abort=null,this.audio&&(this.audio.pause(),this.audio.src="",this.audio=null),this.objectUrl&&(URL.revokeObjectURL(this.objectUrl),this.objectUrl=null),this.onStateChange(!1)}async playStreaming(t,n,r,i){const o=new MediaSource;this.objectUrl=URL.createObjectURL(o),t.src=this.objectUrl,await new Promise(c=>o.addEventListener("sourceopen",()=>c(),{once:!0}));const s=o.addSourceBuffer("audio/mpeg"),l=n.getReader();let p=!1;for(;;){const{done:c,value:f}=await l.read();if(c||r.aborted)break;await Vi(s,f),p||(p=!0,t.play().catch(i))}o.readyState==="open"&&o.endOfStream(),p||t.play().catch(i)}async playBuffered(t,n,r){const i=await n.blob();this.objectUrl=URL.createObjectURL(i),t.src=this.objectUrl,await t.play().catch(r)}}function Bi(){return typeof MediaSource<"u"&&typeof MediaSource.isTypeSupported=="function"&&MediaSource.isTypeSupported("audio/mpeg")}function Vi(e,t){return new Promise((n,r)=>{const i=()=>{e.removeEventListener("updateend",i),n()};e.addEventListener("updateend",i),e.addEventListener("error",r,{once:!0});try{e.appendBuffer(t)}catch(o){r(o)}})}class pe{constructor(){this.recorder=null,this.chunks=[],this.stream=null,this.audio=null,this.silenceTimer=null}static get supported(){return typeof MediaRecorder<"u"&&typeof navigator<"u"&&!!navigator.mediaDevices?.getUserMedia}static async alreadyAllowed(){try{return(await navigator.permissions.query({name:"microphone"})).state==="granted"}catch{return!1}}get recording(){return this.recorder?.state==="recording"}async start(t){this.recording||(this.stream=await navigator.mediaDevices.getUserMedia({audio:!0}),this.chunks=[],this.recorder=new MediaRecorder(this.stream,Wi()),this.recorder.addEventListener("dataavailable",n=>{n.data.size>0&&this.chunks.push(n.data)}),this.recorder.start(250),t&&this.watchForSilence(t))}watchForSilence(t){if(!this.stream)return;const n=window.AudioContext??window.webkitAudioContext;if(!n)return;this.audio=new n;const r=this.audio.createMediaStreamSource(this.stream),i=this.audio.createAnalyser();i.fftSize=1024,r.connect(i);const o=new Uint8Array(i.frequencyBinCount);let s=!1,l=0;const p=()=>{if(!this.recording)return;i.getByteTimeDomainData(o);let c=0;for(const a of o)c=Math.max(c,Math.abs(a-128));const f=c>6,h=Date.now();if(f)s=!0,l=0;else if(s){if(l===0)l=h;else if(h-l>2600){t();return}}this.silenceTimer=window.setTimeout(p,120)};p()}async stop(){const t=this.recorder;if(!t||t.state==="inactive")return this.release(),null;const n=await new Promise(r=>{t.addEventListener("stop",()=>r(new Blob(this.chunks,{type:t.mimeType||"audio/webm"})),{once:!0}),t.stop()});return this.release(),n.size>0?n:null}cancel(){this.recorder&&this.recorder.state!=="inactive"&&this.recorder.stop(),this.release()}release(){this.silenceTimer!==null&&window.clearTimeout(this.silenceTimer),this.silenceTimer=null,this.audio?.close().catch(()=>{}),this.audio=null,this.stream?.getTracks().forEach(t=>t.stop()),this.stream=null,this.recorder=null,this.chunks=[]}}function Wi(){for(const e of["audio/webm;codecs=opus","audio/webm","audio/mp4"])if(MediaRecorder.isTypeSupported?.(e))return{mimeType:e};return{}}const yn={active:!1,muted:!1,phase:"listening"};function Ki(e,t){switch(t.type){case"start":return e.active?e:{active:!0,muted:!1,phase:"listening"};case"end":return yn}if(!e.active)return e;switch(t.type){case"toggleMute":return{...e,muted:!e.muted};case"heard":return e.phase==="listening"?{...e,phase:"thinking"}:e;case"answered":return e.phase==="speaking"?e:{...e,phase:"speaking"};case"spoke":return e.phase==="speaking"?{...e,phase:"listening"}:e;case"unheard":return e.phase==="listening"?e:{...e,phase:"listening"};default:return e}}function Yi(e){return e.active?e.phase==="listening"?e.muted?"Muted":"Listening":e.phase==="thinking"?"Thinking":"Speaking":""}function Ji(e){return e.active&&!e.muted&&e.phase==="listening"}const B={viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":1.8,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"},Xi=()=>u("svg",{...B,children:u("path",{d:"M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"})}),vn=()=>u("svg",{...B,children:u("path",{d:"m6 6 12 12M18 6 6 18"})}),Zi=()=>u("svg",{...B,children:u("path",{d:"M4.5 12h13M12 5.5 18.5 12 12 18.5"})}),wn=()=>u("svg",{...B,children:[u("rect",{x:"9",y:"3",width:"6",height:"11",rx:"3"}),u("path",{d:"M5 11a7 7 0 0 0 14 0M12 18v3"})]}),Qi=()=>u("svg",{...B,children:[u("path",{d:"M15 5a3 3 0 0 0-6 0v4M9 12v2a3 3 0 0 0 4.6 2.5"}),u("path",{d:"M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.6 2.8M12 18v3"}),u("path",{d:"m4 3 16 18"})]}),eo=()=>u("svg",{...B,children:[u("path",{d:"M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"}),u("path",{d:"M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"})]}),to=()=>u("svg",{...B,children:u("path",{d:"M6.5 3.5h3l1.5 4-2 1.3a12 12 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"})}),no=()=>u("svg",{...B,children:[u("path",{d:"M8.2 4.2h2.4l1.2 3.4-1.7 1.1a11 11 0 0 0 4.6 4.6l1.1-1.7 3.4 1.2v2.4a1.8 1.8 0 0 1-2 1.8A14.6 14.6 0 0 1 6.4 6.2a1.8 1.8 0 0 1 1.8-2Z"}),u("path",{d:"m3.5 3.5 17 17"})]}),ro=()=>u("svg",{...B,children:[u("rect",{x:"9",y:"9",width:"11",height:"11",rx:"2.5"}),u("path",{d:"M15 5.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15"})]}),io=()=>u("svg",{...B,children:u("path",{d:"m5 12.5 4.5 4.5L19 7"})}),oo=()=>u("svg",{...B,children:[u("path",{d:"M7 10.5 11 3a2.2 2.2 0 0 1 2.2 2.7L12.5 9h4.7A2 2 0 0 1 19 11.4l-1.3 6A2 2 0 0 1 15.7 19H7"}),u("rect",{x:"3",y:"10",width:"4",height:"9",rx:"1.2"})]}),so=()=>u("svg",{...B,children:[u("path",{d:"M7 13.5 11 21a2.2 2.2 0 0 0 2.2-2.7L12.5 15h4.7A2 2 0 0 0 19 12.6l-1.3-6A2 2 0 0 0 15.7 5H7"}),u("rect",{x:"3",y:"5",width:"4",height:"9",rx:"1.2"})]});function ao({state:e,transcript:t,onToggleMute:n,onEnd:r}){const i=Yi(e);return u("div",{class:"pl-call",role:"group","aria-label":"Call controls",children:[u("div",{class:"pl-call__state",children:[u("span",{class:`pl-call__pulse pl-call__pulse--${e.muted?"muted":e.phase}`,"aria-hidden":"true"}),u("span",{class:"pl-call__body",children:[u("span",{class:"pl-call__label",role:"status","aria-live":"polite",children:i}),t&&u("span",{class:"pl-call__transcript",children:t})]})]}),u("button",{type:"button",class:"pl-icon-btn","aria-pressed":e.muted,"aria-label":e.muted?"Unmute the microphone":"Mute the microphone",title:e.muted?"Unmute":"Mute",onClick:n,children:e.muted?u(Qi,{}):u(wn,{})}),u("button",{type:"button",class:"pl-btn pl-btn--end",onClick:r,children:[u(no,{}),u("span",{children:"End call"})]})]})}function lo(e){const t=O(null),[n,r]=M(0);H(()=>{t.current?.focus()},[e.focusToken]),H(()=>{const o=t.current;o&&(o.style.height="auto",o.style.height=`${Math.min(o.scrollHeight,96)}px`,o.style.overflowY=o.scrollHeight>96?"auto":"hidden",r(o.scrollHeight))},[e.value]);const i=e.recording?"Stop and send":"Dictate a question";return u("form",{class:"pl-composer",onSubmit:o=>{o.preventDefault(),e.onSubmit()},children:[u("div",{class:"pl-composer__field",children:[u("textarea",{ref:t,rows:1,"data-height":n,value:e.value,placeholder:e.transcribing?"Transcribing...":e.recording?"Listening...":"Ask a question","aria-label":"Ask a question",disabled:e.transcribing,onInput:o=>e.onInput(o.currentTarget.value),onKeyDown:o=>{o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),e.onSubmit())}}),e.voiceSupported&&u("button",{type:"button",class:"pl-icon-btn","aria-pressed":e.recording,"aria-label":i,title:i,onClick:()=>e.onToggleRecording(),children:u(wn,{})})]}),u("button",{type:"submit",class:"pl-send","aria-label":"Send",disabled:e.busy||e.value.trim().length===0,children:u(Zi,{})})]})}function co({open:e,unread:t,onClick:n}){return u("button",{type:"button",class:"pl-launcher","aria-label":e?"Close support":t?"Open support, one new answer":"Open support","aria-expanded":e,onClick:n,children:[e?u(vn,{}):u(Xi,{}),!e&&t&&u("span",{class:"pl-launcher__dot","aria-hidden":"true"})]})}function xn({text:e,rating:t,canRate:n,onRate:r}){const[i,o]=M(!1),s=async()=>{try{await navigator.clipboard.writeText(e),o(!0),setTimeout(()=>o(!1),1600)}catch{}};return u("div",{class:"pl-answer-actions",children:[u("button",{type:"button",class:"pl-mini",onClick:()=>void s(),"aria-label":i?"Copied":"Copy the answer",children:[i?u(io,{}):u(ro,{}),u("span",{children:i?"Copied":"Copy"})]}),u("span",{class:"pl-answer-actions__spacer"}),t?u("span",{class:"pl-answer-actions__thanks",children:"Thank you"}):u(ae,{children:[u("button",{type:"button",class:"pl-mini pl-mini--icon",disabled:!n,"aria-label":"This answer helped",title:"This answer helped",onClick:()=>r("up"),children:u(oo,{})}),u("button",{type:"button",class:"pl-mini pl-mini--icon",disabled:!n,"aria-label":"This answer did not help",title:"This answer did not help",onClick:()=>r("down"),children:u(so,{})})]})]})}const uo=600,kn=40;function Sn(){return typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches}function po(e){return e.match(/\S+\s*/g)??[]}function En(e){const[t,n]=M(()=>Sn()?e:""),r=O(!1);return H(()=>{if(r.current||Sn()||!e){n(e);return}r.current=!0;const i=po(e),o=Math.max(1,Math.ceil(i.length/Math.max(1,uo/kn)));let s=0;const l=setInterval(()=>{if(s+=o,s>=i.length){clearInterval(l),n(e);return}n(i.slice(0,s).join(""))},kn);return()=>clearInterval(l)},[e]),t}const ho={no_repository:"The team has not connected a repository yet, so I cannot report this.",failed:"The report could not be sent. Nothing was lost, so try again in a moment."};function fo({text:e,request:t,escalation:n,reporting:r,blocked:i,noted:o,elapsedSeconds:s,rating:l,canRate:p,onReport:c,onRate:f}){const h=En(e),a=h===e;return u("div",{class:"pl-card",children:[u("p",{children:h}),a&&!n&&!i&&t&&u("div",{class:"pl-card__actions",children:[u("button",{type:"button",class:"pl-btn pl-btn--accent",onClick:c,disabled:r,children:r?"Reporting":"Report to developers"}),u("span",{class:"pl-card__label",children:t.title})]}),a&&!n&&i&&u("p",{class:"pl-card__note",children:ho[i]}),a&&!n&&!i&&o&&u("p",{class:"pl-card__note",children:"I have noted this for the team."}),n&&u(mo,{escalation:n,elapsedSeconds:s}),a&&u(xn,{text:e,rating:l,canRate:p,onRate:f})]})}const go=[{key:"filed",label:"Your request was sent to the team",statuses:["filing","filed","updated","inspecting","drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"drafted",label:"Someone is working on it",statuses:["drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"pr",label:"A change is ready for review",statuses:["pr_open","awaiting_approval","approved","merging","deploying","shipped"]},{key:"approval",label:"Waiting on a final check",statuses:["awaiting_approval","approved","merging","deploying","shipped"]},{key:"shipped",label:"Done, it is live",statuses:["shipped"]}],Tn=["queued","filing","filed","updated","inspecting","drafting","pr_open","awaiting_approval","approved","merging","deploying","shipped"];function mo({escalation:e,elapsedSeconds:t}){const n=e.status,r=Tn.indexOf(n);return n==="failed"||n==="rejected"?u("p",{class:"pl-timeline__note",children:n==="rejected"?"A developer decided not to build this for now.":"The report could not be completed. The team has the details."}):u(ae,{children:[u("span",{class:"pl-card__label",children:"Progress"}),u("ul",{class:"pl-timeline",children:go.map(i=>{const o=i.statuses.includes(n),s=Tn.indexOf(i.statuses[0]),l=o?r>s?"done":"current":"pending";return u("li",{"data-state":l,children:[u("span",{class:"pl-timeline__mark"}),u("span",{class:"pl-timeline__body",children:[u("span",{children:bo(i,e)}),l==="current"&&t>10&&u("span",{class:"pl-timeline__note",children:[t,"s so far"]})]})]},i.key)})})]})}function bo(e,t){return e.key==="filed"&&t.issueUrl?u("a",{class:"pl-link",href:t.issueUrl,target:"_blank",rel:"noreferrer noopener",children:"See your request on GitHub"}):e.key==="pr"&&t.prUrl?u("a",{class:"pl-link",href:t.prUrl,target:"_blank",rel:"noreferrer noopener",children:"See the change on GitHub"}):e.key==="shipped"&&t.deploymentUrl?u("a",{class:"pl-link",href:t.deploymentUrl,target:"_blank",rel:"noreferrer noopener",children:"It is live now, reload the page to use it"}):e.label}function _o({text:e,steps:t,plan:n,sources:r,guiding:i,rating:o,canRate:s,onShowMe:l,onRate:p}){const c=En(e),f=c===e,h=n?.total??t?.length??0;return u("div",{class:"pl-card",children:[u("p",{children:c}),f&&t&&t.length>0&&u("div",{class:"pl-card__actions",children:[u("button",{type:"button",class:"pl-btn pl-btn--accent",onClick:l,disabled:i,children:i?"Showing you":"Show me"}),u("span",{class:"pl-card__label",children:[h," step",h===1?"":"s"]})]}),f&&r&&r.length>0&&u("p",{class:"pl-card__note",children:["From:"," ",r.map((a,g)=>u("span",{children:[g>0?", ":"",a.url?u("a",{class:"pl-link",href:a.url,target:"_blank",rel:"noreferrer",children:a.title}):a.title]},`${a.title}-${g}`))]}),f&&u(xn,{text:e,rating:o,canRate:s,onRate:p})]})}const we=["reading","docs","page","code","deciding","writing"],yo={reading:"Reading your question",docs:"Checking the documentation",page:"Looking at this page",code:"Checking known product capabilities",deciding:"Deciding",writing:"Writing the answer"},Ve="reading",vo=700,wo=8e3,xo="Still working";function ko(e){switch(e.type){case"conversation":return"reading";case"understanding":return e.intent==="chat"||e.intent==="page"?"writing":"docs";case"probe":return e.status==="running"?"docs":e.probe==="docs"?"page":e.probe==="interface"?"code":"deciding";case"verdict":return"writing";default:return null}}function So(e,t){const n=ko(t);return n&&we.indexOf(n)>we.indexOf(e)?n:e}function Eo(e,t){const n=we.indexOf(e);return we.indexOf(t)>n?we[n+1]:e}function To(e,t){const n=yo[e];return t>=wo?`${n}. ${xo}`:n}function Ao({stage:e,elapsedMs:t}){return u("div",{class:"pl-thinking",role:"status","aria-live":"polite",children:[u("span",{class:"pl-typing","aria-hidden":"true",children:[u("span",{}),u("span",{}),u("span",{})]}),u("span",{class:"pl-thinking__line",children:To(e,t)})]})}const An=40;function Lo({turns:e,workingTurnId:t,stage:n,workingMs:r,guidingTurnId:i,elapsedSeconds:o,scroll:s,onShowMe:l,onReport:p,onRate:c}){const f=O(null),h=O(!0),a=O(!1);return Xn(()=>{const b=f.current;!b||a.current||(a.current=!0,!(s.current<0)&&(b.scrollTop=s.current,h.current=b.scrollHeight-b.scrollTop-b.clientHeight<An))},[s]),H(()=>{const b=f.current;!b||!h.current||(b.scrollTop=b.scrollHeight,s.current=b.scrollTop)},[e,t,n,s]),u("div",{class:"pl-messages",ref:f,onScroll:()=>{const b=f.current;b&&(s.current=b.scrollTop,h.current=b.scrollHeight-b.scrollTop-b.clientHeight<An)},children:[e.length===0&&u("div",{class:"pl-empty",children:[u("h3",{children:"How can we help?"}),u("p",{children:"Ask a question and we will point at the right control on this page."})]}),e.map(b=>u(Co,{turn:b,working:t===b.id,stage:n,workingMs:r,guiding:i===b.id,elapsedSeconds:o,onShowMe:l,onReport:p,onRate:c},b.id))]})}function Co({turn:e,working:t,stage:n,workingMs:r,guiding:i,elapsedSeconds:o,onShowMe:s,onReport:l,onRate:p}){const c=e.answer?.escalation,f=!!e.messageId,h=a=>p(e,a);return u(ae,{children:[u("div",{class:"pl-msg pl-msg--user",children:u("p",{children:e.question})}),e.memory&&e.memory.length>0&&u("p",{class:"pl-recall",children:"Welcome back."}),t&&u(Ao,{stage:n,elapsedMs:r}),e.error&&u("div",{class:"pl-msg pl-msg--agent",children:u("p",{children:e.error})}),e.answer&&c&&(c.offered===!0||c.reason)&&u(fo,{text:e.answer.text,request:c.offered===!0?c.request:void 0,escalation:e.escalation,reporting:e.reporting,blocked:e.reportBlocked??(c.offered===!0?void 0:c.reason),noted:e.answer.noted,elapsedSeconds:o,rating:e.rating,canRate:f,onReport:()=>l(e),onRate:h}),e.answer&&c?.offered!==!0&&!c?.reason&&u(_o,{text:e.answer.text,steps:e.answer.steps,plan:e.answer.plan,sources:e.answer.sources,guiding:i,rating:e.rating,canRate:f,onShowMe:()=>s(e),onRate:h})]})}const Io='button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';function Mo({title:e,subtitle:t,speaking:n,onCall:r,onStopSpeaking:i,onClose:o,onEscape:s,children:l}){const p=O(null);return H(()=>{const c=p.current;if(!c)return;const f=h=>{if(h.key==="Escape"){h.stopPropagation(),s();return}if(h.key!=="Tab")return;const a=Array.from(c.querySelectorAll(Io)).filter(v=>v.offsetParent!==null||v===c.ownerDocument.activeElement);if(a.length===0)return;const g=a[0],b=a[a.length-1],w=c.getRootNode().activeElement;!h.shiftKey&&w===b?(h.preventDefault(),g.focus()):h.shiftKey&&w===g&&(h.preventDefault(),b.focus())};return c.addEventListener("keydown",f),()=>c.removeEventListener("keydown",f)},[s]),u("div",{class:"pl-panel",role:"dialog","aria-label":e,ref:p,children:[u("header",{class:"pl-header",children:[u("div",{class:"pl-header__text",children:[u("p",{class:"pl-header__title",children:e}),u("p",{class:"pl-header__sub",children:t})]}),u("span",{class:"pl-header__spacer"}),r&&u("button",{type:"button",class:"pl-btn pl-btn--call",onClick:r,children:[u(to,{}),u("span",{children:"Start a call"})]}),n&&u("button",{type:"button",class:"pl-icon-btn","aria-label":"Stop speaking",onClick:i,children:u(eo,{})}),u("button",{type:"button",class:"pl-icon-btn","aria-label":"Close support",onClick:o,children:u(vn,{})})]}),l]})}function No(e,t){return{id:e,question:t,probes:{docs:{status:"pending"},interface:{status:"pending"},repository:{status:"pending"}}}}const bt="lantern:call";function We(e){try{e?sessionStorage.setItem(bt,"1"):sessionStorage.removeItem(bt)}catch{}}function Oo(){try{return sessionStorage.getItem(bt)==="1"}catch{return!1}}const Ln=new Set(["shipped","failed","rejected"]),Ro=["queued","filing","inspecting","drafting","pr_open","awaiting_approval","approved","rejected","merging","deploying","shipped","failed"];function Po(e){return Ro.includes(e)?e:"queued"}function Do({client:e,shadow:t,host:n,position:r,register:i}){const[o,s]=M(!1),[l,p]=M([]),[c,f]=M(""),[h,a]=M(!1),[g,b]=M(null),[w,v]=M(""),[E,_]=M(!1),[d,k]=M(!1),[x,R]=M(!1),[G,$]=M(0),[F,I]=M(!1),[N,Z]=M(0),[q,re]=M(null),[ke,he]=M(Ve),[Ke,Se]=M(Ve),[Ye,fe]=M(0),[ie,V]=Vt(Ki,yn),[is,_t]=M(""),Je=O(null),Xe=O(void 0),se=O(null),Ee=O(null),ce=O(null),os=O(0),ss=O(-1),Q=O(ie);Q.current=ie;const W=Ge(()=>new pe,[]),Hn=O(()=>{}),ue=Ge(()=>new zi(R,()=>Hn.current()),[]);Hn.current=()=>{Q.current.active&&V({type:"spoke"})};const ge=U(m=>Be({question:m,exclude:n}),[n]),Y=U((m,y)=>{p(S=>S.map(P=>P.id===m?y(P):P))},[]),Te=U(()=>{se.current?.stop(),Ee.current?.hide(),ce.current=null,b(null)},[]),Un=U(m=>{const y=Ee.current;if(y){if(m.state==="DONE"||m.state==="FAILED"){y.hide(),ce.current=null,b(null),s(!0),v(m.state==="DONE"?"Guidance finished.":m.message??"Guidance stopped.");return}if(!m.step||!m.target){y.hide();return}if(y.show({target:m.target,caption:m.step.caption,index:m.stepIndex,total:m.total,isLast:m.stepIndex===m.total-1,busy:m.state!=="SPOTLIGHTING"}),m.state==="SPOTLIGHTING"){const S=m.message?`${m.message} `:"";v(`${S}Step ${m.stepIndex+1} of ${m.total}. ${m.step.caption}`)}}},[]),Gn=U(async m=>{const y=ce.current;if(!y)return null;const S=ge(y.question);Je.current=S;let P=null,J=!1;try{await e.ask({question:y.question,page:S.page,conversationId:Xe.current,continueFrom:m,onEvent:j=>{j.type==="answer"&&(P=j.steps,J=j.routeChanged===!0)}})}catch{return null}return P?{...S,steps:P,routeChanged:J}:null},[e,ge]),Ze=U(()=>{Ee.current||(Ee.current=new br(t,{onNext:()=>se.current?.next(),onDone:()=>se.current?.next(),onStop:()=>Te(),onLost:()=>se.current?.lost()})),se.current||(se.current=new dr({rescan:()=>{const m=ce.current,y=ge(m?.question??"");return Je.current=y,y},replan:Gn,onChange:Un,watch:m=>ar(m,300)}))},[Un,Gn,ge,t,Te]),yt=U(m=>{const y=m.answer?.steps,S=Je.current;!y||y.length===0||!S||(Ze(),ce.current={turnId:m.id,question:m.question},b(m.id),s(!1),se.current?.start(S,y))},[Ze]),vt=O(o);vt.current=o;const qn=O(ke);qn.current=ke;const Ae=U(async m=>{const y=m.trim();if(!y||h)return;s(!0),f(""),a(!0);const S=`t${os.current+=1}`;let P=No(S,y);p(z=>[...z,P]),re(S),he(Ve),Se(Ve),fe(0);const J=z=>{P=z,Y(S,()=>z)},j=ge(y);Je.current=j,Ze();try{await e.ask({question:y,page:j.page,conversationId:Xe.current,onEvent:z=>{if(he(Ce=>So(Ce,z)),J($o(P,z,Xe)),z.type==="answer")if(re(null),vt.current||I(!0),z.steps?.length&&yt(P),Q.current.active){const Ce=z.text;V({type:"answered"}),ue.play(ps=>e.speak(Ce,ps))}else Z(Ce=>Ce+1)}})}catch{J({...P,error:"The support service is not reachable right now."})}finally{re(null),a(!1),Q.current.active&&Q.current.phase==="thinking"&&V({type:"unheard"})}},[h,e,Ze,Y,ue,ge,yt]),as=U(async m=>{const y=Xe.current;if(!(!y||!m.messageId||m.reporting||m.escalationId)){Y(m.id,S=>({...S,reporting:!0,reportBlocked:void 0}));try{const S=await e.escalate(y,m.messageId);if(!S.ok){Y(m.id,j=>({...j,reporting:!1,reportBlocked:S.reason}));return}const{escalationId:P,status:J}=S;Y(m.id,j=>({...j,reporting:!1,escalationId:P,escalation:{id:P,status:Po(J)}})),Ho(e,P,j=>{Y(m.id,z=>(z.escalation?.status!==j.status&&$(0),{...z,escalation:j}))})}catch{Y(m.id,S=>({...S,reporting:!1,reportBlocked:"failed"}))}}},[e,Y]),ls=U(async(m,y)=>{const S=m.messageId;if(!S||m.rating)return;Y(m.id,J=>({...J,rating:y})),v("Thank you for the feedback."),await e.feedback(S,y)||Y(m.id,J=>({...J,rating:void 0}))},[e,Y]);H(()=>{if(!l.some(S=>S.escalation&&!Ln.has(S.escalation.status)))return;const y=setInterval(()=>$(S=>S+1),1e3);return()=>clearInterval(y)},[l]),H(()=>{if(!q)return;const m=Date.now(),y=setInterval(()=>fe(Date.now()-m),500);return()=>clearInterval(y)},[q]),H(()=>{if(!q)return;const m=setInterval(()=>Se(y=>Eo(y,qn.current)),vo);return()=>clearInterval(m)},[q]),H(()=>{o&&I(!1)},[o]);const wt=U(()=>{V({type:"end"}),We(!1),W.cancel(),_(!1),ue.stop(),_t(""),Z(m=>m+1)},[ue,W]),cs=U(()=>{if(!pe.supported){v("This browser cannot use the microphone.");return}s(!0),_t(""),V({type:"start"}),We(!0),v("The call has started. Speak when you are ready.")},[]),Le=U(()=>{Q.current.active&&wt(),s(!1)},[wt]);H(()=>{if(!Oo()||!pe.supported)return;let m=!1;return pe.alreadyAllowed().then(y=>{if(!m){if(!y){We(!1);return}s(!0),V({type:"start"})}}),()=>{m=!0}},[]),H(()=>{const m=y=>{y.key==="Escape"&&(ce.current?Te():vt.current&&Le())};return document.addEventListener("keydown",m),()=>document.removeEventListener("keydown",m)},[Le,Te]),H(()=>{i({open:()=>s(!0),close:()=>s(!1),ask:m=>void Ae(m)})},[Ae,i]),H(()=>()=>{se.current?.dispose(),Ee.current?.destroy(),ue.stop(),W.cancel()},[ue,W]),H(()=>{const m=ji(e,n);return()=>m.dispose()},[e,n]);const Qe=U(async()=>{_(!1);let m=null;try{m=await W.stop()}catch{m=null}Q.current.active&&V({type:"heard"}),k(!0);try{if(!m){Q.current.active&&V({type:"unheard"});return}const y=await e.transcribe(m);y?(_t(y),f(y),Ae(y)):(v("I did not catch that. Try again."),Q.current.active&&V({type:"unheard"}))}catch{v("The microphone is not available."),Q.current.active&&V({type:"unheard"})}finally{k(!1)}},[Ae,e,W]),xt=O(Qe);xt.current=Qe,H(()=>{if(!Ji(ie))return;let m=!1;return(async()=>{try{await W.start(()=>void xt.current()),m?W.cancel():_(!0)}catch{v("Microphone access was declined."),V({type:"end"}),We(!1)}})(),()=>{m=!0,W.cancel(),_(!1)}},[ie,W]);const us=U(async()=>{if(E){await Qe();return}try{await W.start(()=>void xt.current()),_(!0)}catch{v("Microphone access was declined.")}},[Qe,W,E]),ds=ie.active?"On a call":h?"Working on it":"We can show you on this page";return u("div",{class:"pl-root","data-position":r,children:[u("div",{class:"pl-sr",role:"status","aria-live":"polite",children:w}),o&&u(Mo,{title:"Support",subtitle:ds,speaking:x&&!ie.active,onCall:ie.active||!pe.supported?void 0:cs,onStopSpeaking:()=>ue.stop(),onClose:Le,onEscape:()=>ce.current?Te():Le(),children:[u(Lo,{turns:l,workingTurnId:q,stage:Ke,workingMs:Ye,guidingTurnId:g,elapsedSeconds:G,scroll:ss,onShowMe:yt,onReport:m=>void as(m),onRate:(m,y)=>void ls(m,y)}),ie.active?u(ao,{state:ie,transcript:is,onToggleMute:()=>V({type:"toggleMute"}),onEnd:wt}):u(lo,{value:c,busy:h,voiceSupported:pe.supported,recording:E,transcribing:d,focusToken:N,onInput:f,onSubmit:()=>void Ae(c),onToggleRecording:()=>void us()})]}),u(co,{open:o,unread:F,onClick:()=>o?Le():s(!0)})]})}function $o(e,t,n){switch(t.type){case"conversation":return n.current=t.conversationId,{...e,messageId:t.messageId};case"understanding":return{...e,feature:t.feature,memory:t.memory};case"probe":return{...e,probes:{...e.probes,[t.probe]:t.status==="running"?{status:"running"}:{status:"done",result:t.result}}};case"verdict":return{...e,verdict:t.verdict};case"answer":return{...e,answer:{text:t.text,steps:t.steps,escalation:t.escalation,noted:t.noted,plan:t.plan,sources:t.sources}};case"error":return{...e,error:t.message}}}function Ho(e,t,n){let r=!1;const i=async()=>{if(!r){try{const o=await e.escalation(t);if(n(o),Ln.has(o.status)){r=!0;return}}catch{}setTimeout(i,3e3)}};i()}class Uo{constructor(){this.buffer=""}push(t){this.buffer+=t.replace(/\r\n/g,`
`);const n=[];let r=this.buffer.indexOf(`

`);for(;r!==-1;){const i=Cn(this.buffer.slice(0,r));this.buffer=this.buffer.slice(r+2),i!==null&&n.push(i),r=this.buffer.indexOf(`

`)}return n}flush(){const t=this.buffer.trim();if(this.buffer="",!t)return[];const n=Cn(t);return n===null?[]:[n]}}function Cn(e){const t=[];for(const n of e.split(`
`)){if(!n||n.startsWith(":"))continue;const r=n.indexOf(":");if((r===-1?n:n.slice(0,r))!=="data")continue;const i=r===-1?"":n.slice(r+1);t.push(i.startsWith(" ")?i.slice(1):i)}return t.length===0?null:t.join(`
`)}const Go=["docs","interface","repository"],qo=["chat","page","product","mixed"],X=e=>typeof e=="object"&&e!==null;function In(e){let t;try{t=JSON.parse(e)}catch{return null}if(!X(t))return null;switch(t.type){case"conversation":return typeof t.conversationId!="string"||typeof t.messageId!="string"?null:{type:"conversation",conversationId:t.conversationId,messageId:t.messageId};case"understanding":{if(typeof t.feature!="string")return null;const n=qo.find(i=>i===t.intent)??"product",r=Array.isArray(t.memory)?t.memory.filter(i=>typeof i=="string"):[];return{type:"understanding",feature:t.feature,intent:n,memory:r}}case"probe":{if(typeof t.probe!="string"||!Go.includes(t.probe))return null;const n=t.probe;return t.status==="running"?{type:"probe",probe:n,status:"running"}:t.status==="done"&&X(t.result)?{type:"probe",probe:n,status:"done",result:Fo(n,t.result)}:null}case"verdict":return X(t.verdict)?{type:"verdict",verdict:jo(t.verdict)}:null;case"answer":{if(typeof t.text!="string")return null;const n={type:"answer",text:t.text,steps:Vo(t.steps),escalation:Jo(t.escalation),noted:t.noted===!0},r=Ko(t.plan);r&&(n.plan=r);const i=Yo(t.sources);return i.length&&(n.sources=i),t.routeChanged===!0&&(n.routeChanged=!0),n}case"error":return{type:"error",message:typeof t.message=="string"?t.message:"Something went wrong."};default:return null}}function Fo(e,t){return{probe:e,hit:t.hit===!0,score:typeof t.score=="number"?t.score:null,summary:typeof t.summary=="string"?t.summary:"",evidence:t.evidence??null,latencyMs:typeof t.latencyMs=="number"?t.latencyMs:0}}function jo(e){const t=e.outcome;return{outcome:t==="answer"||t==="absent"?t:"hedge",confidence:typeof e.confidence=="number"?e.confidence:0,reasoning:typeof e.reasoning=="string"?e.reasoning:"",feature:typeof e.feature=="string"?e.feature:""}}const zo=["click","input","navigation","manual"];function Bo(e){if(!X(e)||typeof e.role!="string"||typeof e.name!="string"||typeof e.route!="string"||e.name.trim()===""||e.route==="")return null;const t={role:e.role,name:e.name,route:e.route};return typeof e.landmark=="string"&&e.landmark&&(t.landmark=e.landmark),typeof e.href=="string"&&e.href&&(t.href=e.href),t}function Vo(e){if(!Array.isArray(e))return null;const t=[];for(const n of e){if(!X(n)||typeof n.caption!="string")continue;const r=Bo(n.control),i=typeof n.target=="string"?n.target:null;if(i===null&&!r)continue;const o={target:i,caption:n.caption,advanceOn:typeof n.advanceOn=="string"&&zo.includes(n.advanceOn)?n.advanceOn:"click"};r&&(o.control=r),t.push(o)}return t.length===0||t[0].target===null?null:t}const Wo=["graph","cached","page"];function Ko(e){if(!X(e)||typeof e.total!="number"||!Number.isFinite(e.total))return null;const t={source:typeof e.source=="string"&&Wo.includes(e.source)?e.source:"page",total:Math.max(0,Math.round(e.total))};return X(e.destination)&&typeof e.destination.route=="string"&&(t.destination={route:e.destination.route,title:typeof e.destination.title=="string"?e.destination.title:""}),t}function Yo(e){if(!Array.isArray(e))return[];const t=[];for(const n of e)!X(n)||typeof n.title!="string"||n.title.trim()===""||t.push({title:n.title,url:typeof n.url=="string"&&n.url?n.url:null});return t}function Jo(e){return X(e)?e.offered===!0&&X(e.request)?{offered:!0,request:e.request}:e.reason==="no_repository"?{offered:!1,reason:"no_repository"}:{offered:!1}:{offered:!1}}const Mn="lantern:visitor";function Nn(){const e=new Uint8Array(16);return crypto.getRandomValues(e),Array.from(e,t=>t.toString(16).padStart(2,"0")).join("")}function On(){try{const e=localStorage.getItem(Mn);if(e&&/^[0-9a-f]{32}$/.test(e))return e;const t=Nn();return localStorage.setItem(Mn,t),t}catch{return Nn()}}class Xo{constructor(t){this.config=t}url(t){return`${this.config.apiBase.replace(/\/$/,"")}${t}`}async ask({question:t,page:n,conversationId:r,continueFrom:i,signal:o,onEvent:s}){const l={key:this.config.key,question:t,page:n,visitorId:On()};r&&(l.conversationId=r),typeof i=="number"&&(l.continueFrom=i);const p=await fetch(this.url("/api/chat"),{method:"POST",headers:{"content-type":"application/json",accept:"text/event-stream"},body:JSON.stringify(l),signal:o});if(!p.ok||!p.body)throw new Error(`Chat request failed (${p.status})`);const c=p.body.getReader(),f=new TextDecoder,h=new Uo;for(;;){const{done:a,value:g}=await c.read();if(a)break;for(const b of h.push(f.decode(g,{stream:!0}))){const w=In(b);w&&s(w)}}for(const a of h.flush()){const g=In(a);g&&s(g)}}async escalate(t,n){const r=await fetch(this.url("/api/escalate"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,conversationId:t,messageId:n,visitorId:On()})}),i=await r.json().catch(()=>({}));return!r.ok||!i.escalationId?{ok:!1,reason:i.reason==="no_repository"?"no_repository":"failed"}:{ok:!0,escalationId:i.escalationId,status:i.status??"queued"}}async escalation(t){const n=await fetch(this.url(`/api/escalations/${encodeURIComponent(t)}?key=${encodeURIComponent(this.config.key)}`));if(!n.ok)throw new Error(`Could not read the report status (${n.status})`);return await n.json()}async feedback(t,n,r){const i={key:this.config.key,messageId:t,rating:n};r&&(i.note=r);try{return(await fetch(this.url("/api/feedback"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(i)})).ok}catch{return!1}}async observe(t){try{await fetch(this.url("/api/site/observe"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,...t}),keepalive:!0})}catch{}}async transcribe(t){const n=new FormData;n.append("key",this.config.key),n.append("file",t,"speech.webm");const r=await fetch(this.url("/api/transcribe"),{method:"POST",body:n});if(!r.ok)throw new Error(`Could not transcribe that (${r.status})`);const i=await r.json();return typeof i.text=="string"?i.text:""}async speak(t,n){const r=await fetch(this.url("/api/speak"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:this.config.key,text:t}),signal:n});if(!r.ok)throw new Error(`Could not read that out (${r.status})`);return r}}const xe={"--pl-accent":"#2e6f54","--pl-ink":"#17201c","--pl-muted":"#5b645f","--pl-glass":"rgba(255, 253, 247, 0.6)","--pl-radius":"18px"},Rn=`
:host {
  --pl-accent: ${xe["--pl-accent"]};
  --pl-ink: ${xe["--pl-ink"]};
  --pl-muted: ${xe["--pl-muted"]};
  --pl-glass: ${xe["--pl-glass"]};
  --pl-radius: ${xe["--pl-radius"]};

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
`;function Zo(e){if(typeof CSSStyleSheet<"u"&&"adoptedStyleSheets"in Document.prototype)try{const n=new CSSStyleSheet;n.replaceSync(Rn),e.adoptedStyleSheets=[...e.adoptedStyleSheets,n];return}catch{}const t=document.createElement("style");t.textContent=Rn,e.appendChild(t)}function Pn(){const e=[];if(typeof document.elementFromPoint=="function"){const t=document.elementFromPoint(Math.max(innerWidth-120,0),Math.max(innerHeight-30,0));for(let n=t;n;n=n.parentElement)n.tagName.toLowerCase()!=="lantern-widget"&&e.push(n)}e.push(document.body,document.documentElement);for(const t of e){if(!t)continue;const n=getComputedStyle(t).backgroundColor,r=Qo(n);if(r!==null)return r<.4?"dark":"light"}return typeof matchMedia=="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function Qo(e){const t=e.match(/rgba?\(([^)]+)\)/);if(!t)return null;const n=t[1].split(",").map(s=>Number.parseFloat(s.trim()));if(n.length<3||n.some(Number.isNaN)||n.length>3&&n[3]===0)return null;const[r,i,o]=n;return(.2126*r+.7152*i+.0722*o)/255}const Dn="lantern-widget",es="lantern_ask";function ts(){return new URLSearchParams(location.search).get(es)?.trim()??""}function ns(){const t=document.currentScript??document.querySelector("script[data-key]"),n=t?.dataset.key?.trim();if(!n)return console.warn("[lantern] no data-key on the script tag, the widget will not load"),null;const r=t?.src?new URL(t.src,location.href).origin:location.origin,i=t?.dataset.api?.trim()||r,o=t?.dataset.position==="left"?"left":"right";return{key:n,apiBase:i,position:o}}function $n(e){if(document.querySelector(Dn))return;let t=ts();const n=document.createElement(Dn);n.setAttribute("data-pl-scheme",Pn()),document.body.appendChild(n);const r=n.attachShadow({mode:"open"});Zo(r);const i=document.createElement("div");r.appendChild(i);const o=new MutationObserver(()=>n.setAttribute("data-pl-scheme",Pn()));o.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]}),o.observe(document.body,{attributes:!0,attributeFilter:["class","style","data-theme"]});const s=new Xo({apiBase:e.apiBase,key:e.key});Yn(u(Do,{client:s,shadow:r,host:n,position:e.position,register:l=>{if(window.Lantern=l,t){const p=t;t="",setTimeout(()=>window.Lantern?.ask(p),400)}}}),i)}function rs(){const e=ns();e&&(document.body?$n(e):document.addEventListener("DOMContentLoaded",()=>$n(e),{once:!0}))}rs()})();
