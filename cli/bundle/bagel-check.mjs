import{createRequire as __cr}from'module';const require=__cr(import.meta.url);import{fileURLToPath as __fu}from'url';import{dirname as __dn}from'path';const __filename=__fu(import.meta.url);const __dirname=__dn(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/@foxglove+crc@0.0.3/node_modules/@foxglove/crc/dist/cjs/src/index.js
var require_src = __commonJS({
  "node_modules/.pnpm/@foxglove+crc@0.0.3/node_modules/@foxglove/crc/dist/cjs/src/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.crc32 = exports2.crc32Final = exports2.crc32Update = exports2.crc32Init = exports2.crc32GenerateTables = void 0;
    function crc32GenerateTables({ polynomial, numTables }) {
      const table = new Uint32Array(256 * numTables);
      for (let i = 0; i < 256; i++) {
        let r = i;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        r = (r & 1) * polynomial ^ r >>> 1;
        table[i] = r;
      }
      for (let i = 256; i < table.length; i++) {
        const value = table[i - 256];
        table[i] = table[value & 255] ^ value >>> 8;
      }
      return table;
    }
    exports2.crc32GenerateTables = crc32GenerateTables;
    var CRC32_TABLE = crc32GenerateTables({ polynomial: 3988292384, numTables: 8 });
    function crc32Init3() {
      return ~0;
    }
    exports2.crc32Init = crc32Init3;
    function crc32Update3(prev, data) {
      const byteLength = data.byteLength;
      const view = new DataView(data.buffer, data.byteOffset, byteLength);
      let r = prev;
      let offset = 0;
      const toAlign = -view.byteOffset & 3;
      for (; offset < toAlign && offset < byteLength; offset++) {
        r = CRC32_TABLE[(r ^ view.getUint8(offset)) & 255] ^ r >>> 8;
      }
      if (offset === byteLength) {
        return r;
      }
      offset = toAlign;
      let remainingBytes = byteLength - offset;
      for (; remainingBytes >= 8; offset += 8, remainingBytes -= 8) {
        r ^= view.getUint32(offset, true);
        const r2 = view.getUint32(offset + 4, true);
        r = CRC32_TABLE[0 * 256 + (r2 >>> 24 & 255)] ^ CRC32_TABLE[1 * 256 + (r2 >>> 16 & 255)] ^ CRC32_TABLE[2 * 256 + (r2 >>> 8 & 255)] ^ CRC32_TABLE[3 * 256 + (r2 >>> 0 & 255)] ^ CRC32_TABLE[4 * 256 + (r >>> 24 & 255)] ^ CRC32_TABLE[5 * 256 + (r >>> 16 & 255)] ^ CRC32_TABLE[6 * 256 + (r >>> 8 & 255)] ^ CRC32_TABLE[7 * 256 + (r >>> 0 & 255)];
      }
      for (let i = offset; i < byteLength; i++) {
        r = CRC32_TABLE[(r ^ view.getUint8(i)) & 255] ^ r >>> 8;
      }
      return r;
    }
    exports2.crc32Update = crc32Update3;
    function crc32Final3(prev) {
      return (prev ^ ~0) >>> 0;
    }
    exports2.crc32Final = crc32Final3;
    function crc326(data) {
      return crc32Final3(crc32Update3(crc32Init3(), data));
    }
    exports2.crc32 = crc326;
  }
});

// node_modules/.pnpm/heap-js@2.7.1/node_modules/heap-js/dist/heap-js.umd.js
var require_heap_js_umd = __commonJS({
  "node_modules/.pnpm/heap-js@2.7.1/node_modules/heap-js/dist/heap-js.umd.js"(exports2, module2) {
    (function(global, factory) {
      typeof exports2 === "object" && typeof module2 !== "undefined" ? factory(exports2) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.heap = {}));
    })(exports2, (function(exports3) {
      "use strict";
      var __awaiter = function(thisArg, _arguments, P, generator) {
        function adopt(value) {
          return value instanceof P ? value : new P(function(resolve) {
            resolve(value);
          });
        }
        return new (P || (P = Promise))(function(resolve, reject) {
          function fulfilled(value) {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          }
          function rejected(value) {
            try {
              step(generator["throw"](value));
            } catch (e) {
              reject(e);
            }
          }
          function step(result) {
            result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      };
      var __generator$1 = function(thisArg, body) {
        var _ = { label: 0, sent: function() {
          if (t[0] & 1) throw t[1];
          return t[1];
        }, trys: [], ops: [] }, f2, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
        return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
          return this;
        }), g;
        function verb(n) {
          return function(v) {
            return step([n, v]);
          };
        }
        function step(op) {
          if (f2) throw new TypeError("Generator is already executing.");
          while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f2 = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
              case 0:
              case 1:
                t = op;
                break;
              case 4:
                _.label++;
                return { value: op[1], done: false };
              case 5:
                _.label++;
                y = op[1];
                op = [0];
                continue;
              case 7:
                op = _.ops.pop();
                _.trys.pop();
                continue;
              default:
                if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                  _ = 0;
                  continue;
                }
                if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                  _.label = op[1];
                  break;
                }
                if (op[0] === 6 && _.label < t[1]) {
                  _.label = t[1];
                  t = op;
                  break;
                }
                if (t && _.label < t[2]) {
                  _.label = t[2];
                  _.ops.push(op);
                  break;
                }
                if (t[2]) _.ops.pop();
                _.trys.pop();
                continue;
            }
            op = body.call(thisArg, _);
          } catch (e) {
            op = [6, e];
            y = 0;
          } finally {
            f2 = t = 0;
          }
          if (op[0] & 5) throw op[1];
          return { value: op[0] ? op[1] : void 0, done: true };
        }
      };
      var __read$1 = function(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
          while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        } catch (error) {
          e = { error };
        } finally {
          try {
            if (r && !r.done && (m = i["return"])) m.call(i);
          } finally {
            if (e) throw e.error;
          }
        }
        return ar;
      };
      var __spreadArray$1 = function(to, from, pack) {
        if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
          if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
          }
        }
        return to.concat(ar || Array.prototype.slice.call(from));
      };
      var __values = function(o) {
        var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
        if (m) return m.call(o);
        if (o && typeof o.length === "number") return {
          next: function() {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
          }
        };
        throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
      };
      var HeapAsync = (
        /** @class */
        (function() {
          function HeapAsync2(compare) {
            if (compare === void 0) {
              compare = HeapAsync2.minComparator;
            }
            var _this = this;
            this.compare = compare;
            this.heapArray = [];
            this._limit = 0;
            this.offer = this.add;
            this.element = this.peek;
            this.poll = this.pop;
            this._invertedCompare = function(a, b) {
              return _this.compare(a, b).then(function(res) {
                return -1 * res;
              });
            };
          }
          HeapAsync2.getChildrenIndexOf = function(idx) {
            return [idx * 2 + 1, idx * 2 + 2];
          };
          HeapAsync2.getParentIndexOf = function(idx) {
            if (idx <= 0) {
              return -1;
            }
            var whichChildren = idx % 2 ? 1 : 2;
            return Math.floor((idx - whichChildren) / 2);
          };
          HeapAsync2.getSiblingIndexOf = function(idx) {
            if (idx <= 0) {
              return -1;
            }
            var whichChildren = idx % 2 ? 1 : -1;
            return idx + whichChildren;
          };
          HeapAsync2.minComparator = function(a, b) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                if (a > b) {
                  return [2, 1];
                } else if (a < b) {
                  return [2, -1];
                } else {
                  return [2, 0];
                }
              });
            });
          };
          HeapAsync2.maxComparator = function(a, b) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                if (b > a) {
                  return [2, 1];
                } else if (b < a) {
                  return [2, -1];
                } else {
                  return [2, 0];
                }
              });
            });
          };
          HeapAsync2.minComparatorNumber = function(a, b) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                return [2, a - b];
              });
            });
          };
          HeapAsync2.maxComparatorNumber = function(a, b) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                return [2, b - a];
              });
            });
          };
          HeapAsync2.defaultIsEqual = function(a, b) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                return [2, a === b];
              });
            });
          };
          HeapAsync2.print = function(heap) {
            function deep(i2) {
              var pi = HeapAsync2.getParentIndexOf(i2);
              return Math.floor(Math.log2(pi + 1));
            }
            function repeat(str, times) {
              var out = "";
              for (; times > 0; --times) {
                out += str;
              }
              return out;
            }
            var node = 0;
            var lines = [];
            var maxLines = deep(heap.length - 1) + 2;
            var maxLength = 0;
            while (node < heap.length) {
              var i = deep(node) + 1;
              if (node === 0) {
                i = 0;
              }
              var nodeText = String(heap.get(node));
              if (nodeText.length > maxLength) {
                maxLength = nodeText.length;
              }
              lines[i] = lines[i] || [];
              lines[i].push(nodeText);
              node += 1;
            }
            return lines.map(function(line, i2) {
              var times = Math.pow(2, maxLines - i2) - 1;
              return repeat(" ", Math.floor(times / 2) * maxLength) + line.map(function(el) {
                var half = (maxLength - el.length) / 2;
                return repeat(" ", Math.ceil(half)) + el + repeat(" ", Math.floor(half));
              }).join(repeat(" ", times * maxLength));
            }).join("\n");
          };
          HeapAsync2.heapify = function(arr, compare) {
            return __awaiter(this, void 0, void 0, function() {
              var heap;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heap = new HeapAsync2(compare);
                    heap.heapArray = arr;
                    return [4, heap.init()];
                  case 1:
                    _a.sent();
                    return [2, heap];
                }
              });
            });
          };
          HeapAsync2.heappop = function(heapArr, compare) {
            var heap = new HeapAsync2(compare);
            heap.heapArray = heapArr;
            return heap.pop();
          };
          HeapAsync2.heappush = function(heapArr, item, compare) {
            return __awaiter(this, void 0, void 0, function() {
              var heap;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heap = new HeapAsync2(compare);
                    heap.heapArray = heapArr;
                    return [4, heap.push(item)];
                  case 1:
                    _a.sent();
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            });
          };
          HeapAsync2.heappushpop = function(heapArr, item, compare) {
            var heap = new HeapAsync2(compare);
            heap.heapArray = heapArr;
            return heap.pushpop(item);
          };
          HeapAsync2.heapreplace = function(heapArr, item, compare) {
            var heap = new HeapAsync2(compare);
            heap.heapArray = heapArr;
            return heap.replace(item);
          };
          HeapAsync2.heaptop = function(heapArr, n, compare) {
            if (n === void 0) {
              n = 1;
            }
            var heap = new HeapAsync2(compare);
            heap.heapArray = heapArr;
            return heap.top(n);
          };
          HeapAsync2.heapbottom = function(heapArr, n, compare) {
            if (n === void 0) {
              n = 1;
            }
            var heap = new HeapAsync2(compare);
            heap.heapArray = heapArr;
            return heap.bottom(n);
          };
          HeapAsync2.nlargest = function(n, iterable, compare) {
            return __awaiter(this, void 0, void 0, function() {
              var heap;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heap = new HeapAsync2(compare);
                    heap.heapArray = __spreadArray$1([], __read$1(iterable), false);
                    return [4, heap.init()];
                  case 1:
                    _a.sent();
                    return [2, heap.top(n)];
                }
              });
            });
          };
          HeapAsync2.nsmallest = function(n, iterable, compare) {
            return __awaiter(this, void 0, void 0, function() {
              var heap;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heap = new HeapAsync2(compare);
                    heap.heapArray = __spreadArray$1([], __read$1(iterable), false);
                    return [4, heap.init()];
                  case 1:
                    _a.sent();
                    return [2, heap.bottom(n)];
                }
              });
            });
          };
          HeapAsync2.prototype.add = function(element) {
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    return [4, this._sortNodeUp(this.heapArray.push(element) - 1)];
                  case 1:
                    _a.sent();
                    this._applyLimit();
                    return [2, true];
                }
              });
            });
          };
          HeapAsync2.prototype.addAll = function(elements) {
            return __awaiter(this, void 0, void 0, function() {
              var i, l;
              var _a;
              return __generator$1(this, function(_b) {
                switch (_b.label) {
                  case 0:
                    i = this.length;
                    (_a = this.heapArray).push.apply(_a, __spreadArray$1([], __read$1(elements), false));
                    l = this.length;
                    _b.label = 1;
                  case 1:
                    if (!(i < l)) return [3, 4];
                    return [4, this._sortNodeUp(i)];
                  case 2:
                    _b.sent();
                    _b.label = 3;
                  case 3:
                    ++i;
                    return [3, 1];
                  case 4:
                    this._applyLimit();
                    return [2, true];
                }
              });
            });
          };
          HeapAsync2.prototype.bottom = function() {
            return __awaiter(this, arguments, void 0, function(n) {
              if (n === void 0) {
                n = 1;
              }
              return __generator$1(this, function(_a) {
                if (this.heapArray.length === 0 || n <= 0) {
                  return [2, []];
                } else if (this.heapArray.length === 1) {
                  return [2, [this.heapArray[0]]];
                } else if (n >= this.heapArray.length) {
                  return [2, __spreadArray$1([], __read$1(this.heapArray), false)];
                } else {
                  return [2, this._bottomN_push(~~n)];
                }
              });
            });
          };
          HeapAsync2.prototype.check = function() {
            return __awaiter(this, void 0, void 0, function() {
              var j, el, children, children_1, children_1_1, ch, e_1_1;
              var e_1, _a;
              return __generator$1(this, function(_b) {
                switch (_b.label) {
                  case 0:
                    j = 0;
                    _b.label = 1;
                  case 1:
                    if (!(j < this.heapArray.length)) return [3, 10];
                    el = this.heapArray[j];
                    children = this.getChildrenOf(j);
                    _b.label = 2;
                  case 2:
                    _b.trys.push([2, 7, 8, 9]);
                    children_1 = (e_1 = void 0, __values(children)), children_1_1 = children_1.next();
                    _b.label = 3;
                  case 3:
                    if (!!children_1_1.done) return [3, 6];
                    ch = children_1_1.value;
                    return [4, this.compare(el, ch)];
                  case 4:
                    if (_b.sent() > 0) {
                      return [2, el];
                    }
                    _b.label = 5;
                  case 5:
                    children_1_1 = children_1.next();
                    return [3, 3];
                  case 6:
                    return [3, 9];
                  case 7:
                    e_1_1 = _b.sent();
                    e_1 = { error: e_1_1 };
                    return [3, 9];
                  case 8:
                    try {
                      if (children_1_1 && !children_1_1.done && (_a = children_1.return)) _a.call(children_1);
                    } finally {
                      if (e_1) throw e_1.error;
                    }
                    return [
                      7
                      /*endfinally*/
                    ];
                  case 9:
                    ++j;
                    return [3, 1];
                  case 10:
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            });
          };
          HeapAsync2.prototype.clear = function() {
            this.heapArray = [];
          };
          HeapAsync2.prototype.clone = function() {
            var cloned = new HeapAsync2(this.comparator());
            cloned.heapArray = this.toArray();
            cloned._limit = this._limit;
            return cloned;
          };
          HeapAsync2.prototype.comparator = function() {
            return this.compare;
          };
          HeapAsync2.prototype.contains = function(o_1) {
            return __awaiter(this, arguments, void 0, function(o, fn) {
              var _a, _b, el, e_2_1;
              var e_2, _c;
              if (fn === void 0) {
                fn = HeapAsync2.defaultIsEqual;
              }
              return __generator$1(this, function(_d) {
                switch (_d.label) {
                  case 0:
                    _d.trys.push([0, 5, 6, 7]);
                    _a = __values(this.heapArray), _b = _a.next();
                    _d.label = 1;
                  case 1:
                    if (!!_b.done) return [3, 4];
                    el = _b.value;
                    return [4, fn(el, o)];
                  case 2:
                    if (_d.sent()) {
                      return [2, true];
                    }
                    _d.label = 3;
                  case 3:
                    _b = _a.next();
                    return [3, 1];
                  case 4:
                    return [3, 7];
                  case 5:
                    e_2_1 = _d.sent();
                    e_2 = { error: e_2_1 };
                    return [3, 7];
                  case 6:
                    try {
                      if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                    } finally {
                      if (e_2) throw e_2.error;
                    }
                    return [
                      7
                      /*endfinally*/
                    ];
                  case 7:
                    return [2, false];
                }
              });
            });
          };
          HeapAsync2.prototype.init = function(array) {
            return __awaiter(this, void 0, void 0, function() {
              var i;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    if (array) {
                      this.heapArray = __spreadArray$1([], __read$1(array), false);
                    }
                    i = HeapAsync2.getParentIndexOf(this.length - 1);
                    _a.label = 1;
                  case 1:
                    if (!(i >= 0)) return [3, 4];
                    return [4, this._sortNodeDown(i)];
                  case 2:
                    _a.sent();
                    _a.label = 3;
                  case 3:
                    --i;
                    return [3, 1];
                  case 4:
                    this._applyLimit();
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            });
          };
          HeapAsync2.prototype.isEmpty = function() {
            return this.length === 0;
          };
          HeapAsync2.prototype.leafs = function() {
            if (this.heapArray.length === 0) {
              return [];
            }
            var pi = HeapAsync2.getParentIndexOf(this.heapArray.length - 1);
            return this.heapArray.slice(pi + 1);
          };
          Object.defineProperty(HeapAsync2.prototype, "length", {
            /**
             * Length of the heap.
             * @return {Number}
             */
            get: function() {
              return this.heapArray.length;
            },
            enumerable: false,
            configurable: true
          });
          Object.defineProperty(HeapAsync2.prototype, "limit", {
            /**
             * Get length limit of the heap.
             * @return {Number}
             */
            get: function() {
              return this._limit;
            },
            /**
             * Set length limit of the heap.
             * @return {Number}
             */
            set: function(_l) {
              this._limit = ~~_l;
              this._applyLimit();
            },
            enumerable: false,
            configurable: true
          });
          HeapAsync2.prototype.peek = function() {
            return this.heapArray[0];
          };
          HeapAsync2.prototype.pop = function() {
            return __awaiter(this, void 0, void 0, function() {
              var last;
              return __generator$1(this, function(_a) {
                last = this.heapArray.pop();
                if (this.length > 0 && last !== void 0) {
                  return [2, this.replace(last)];
                }
                return [2, last];
              });
            });
          };
          HeapAsync2.prototype.push = function() {
            var elements = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              elements[_i] = arguments[_i];
            }
            return __awaiter(this, void 0, void 0, function() {
              return __generator$1(this, function(_a) {
                if (elements.length < 1) {
                  return [2, false];
                } else if (elements.length === 1) {
                  return [2, this.add(elements[0])];
                } else {
                  return [2, this.addAll(elements)];
                }
              });
            });
          };
          HeapAsync2.prototype.pushpop = function(element) {
            return __awaiter(this, void 0, void 0, function() {
              var _a;
              return __generator$1(this, function(_b) {
                switch (_b.label) {
                  case 0:
                    return [4, this.compare(this.heapArray[0], element)];
                  case 1:
                    if (!(_b.sent() < 0)) return [3, 3];
                    _a = __read$1([this.heapArray[0], element], 2), element = _a[0], this.heapArray[0] = _a[1];
                    return [4, this._sortNodeDown(0)];
                  case 2:
                    _b.sent();
                    _b.label = 3;
                  case 3:
                    return [2, element];
                }
              });
            });
          };
          HeapAsync2.prototype.remove = function(o_1) {
            return __awaiter(this, arguments, void 0, function(o, fn) {
              var queue, idx, children;
              var _this = this;
              if (fn === void 0) {
                fn = HeapAsync2.defaultIsEqual;
              }
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    if (!this.heapArray.length)
                      return [2, false];
                    if (!(o === void 0)) return [3, 2];
                    return [4, this.pop()];
                  case 1:
                    _a.sent();
                    return [2, true];
                  case 2:
                    queue = [0];
                    _a.label = 3;
                  case 3:
                    if (!queue.length) return [3, 13];
                    idx = queue.shift();
                    return [4, fn(this.heapArray[idx], o)];
                  case 4:
                    if (!_a.sent()) return [3, 11];
                    if (!(idx === 0)) return [3, 6];
                    return [4, this.pop()];
                  case 5:
                    _a.sent();
                    return [3, 10];
                  case 6:
                    if (!(idx === this.heapArray.length - 1)) return [3, 7];
                    this.heapArray.pop();
                    return [3, 10];
                  case 7:
                    this.heapArray.splice(idx, 1, this.heapArray.pop());
                    return [4, this._sortNodeUp(idx)];
                  case 8:
                    _a.sent();
                    return [4, this._sortNodeDown(idx)];
                  case 9:
                    _a.sent();
                    _a.label = 10;
                  case 10:
                    return [2, true];
                  case 11:
                    children = HeapAsync2.getChildrenIndexOf(idx).filter(function(c) {
                      return c < _this.heapArray.length;
                    });
                    queue.push.apply(queue, __spreadArray$1([], __read$1(children), false));
                    _a.label = 12;
                  case 12:
                    return [3, 3];
                  case 13:
                    return [2, false];
                }
              });
            });
          };
          HeapAsync2.prototype.replace = function(element) {
            return __awaiter(this, void 0, void 0, function() {
              var peek;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    peek = this.heapArray[0];
                    this.heapArray[0] = element;
                    return [4, this._sortNodeDown(0)];
                  case 1:
                    _a.sent();
                    return [2, peek];
                }
              });
            });
          };
          HeapAsync2.prototype.size = function() {
            return this.length;
          };
          HeapAsync2.prototype.top = function() {
            return __awaiter(this, arguments, void 0, function(n) {
              if (n === void 0) {
                n = 1;
              }
              return __generator$1(this, function(_a) {
                if (this.heapArray.length === 0 || n <= 0) {
                  return [2, []];
                } else if (this.heapArray.length === 1 || n === 1) {
                  return [2, [this.heapArray[0]]];
                } else if (n >= this.heapArray.length) {
                  return [2, __spreadArray$1([], __read$1(this.heapArray), false)];
                } else {
                  return [2, this._topN_push(~~n)];
                }
              });
            });
          };
          HeapAsync2.prototype.toArray = function() {
            return __spreadArray$1([], __read$1(this.heapArray), false);
          };
          HeapAsync2.prototype.toString = function() {
            return this.heapArray.toString();
          };
          HeapAsync2.prototype.get = function(i) {
            return this.heapArray[i];
          };
          HeapAsync2.prototype.getChildrenOf = function(idx) {
            var _this = this;
            return HeapAsync2.getChildrenIndexOf(idx).map(function(i) {
              return _this.heapArray[i];
            }).filter(function(e) {
              return e !== void 0;
            });
          };
          HeapAsync2.prototype.getParentOf = function(idx) {
            var pi = HeapAsync2.getParentIndexOf(idx);
            return this.heapArray[pi];
          };
          HeapAsync2.prototype[Symbol.iterator] = function() {
            return __generator$1(this, function(_a) {
              switch (_a.label) {
                case 0:
                  if (!this.length) return [3, 2];
                  return [4, this.pop()];
                case 1:
                  _a.sent();
                  return [3, 0];
                case 2:
                  return [
                    2
                    /*return*/
                  ];
              }
            });
          };
          HeapAsync2.prototype.iterator = function() {
            return this;
          };
          HeapAsync2.prototype._applyLimit = function() {
            if (this._limit && this._limit < this.heapArray.length) {
              var rm = this.heapArray.length - this._limit;
              while (rm) {
                this.heapArray.pop();
                --rm;
              }
            }
          };
          HeapAsync2.prototype._bottomN_push = function(n) {
            return __awaiter(this, void 0, void 0, function() {
              var bottomHeap, startAt, parentStartAt, indices, i, arr, i;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    bottomHeap = new HeapAsync2(this.compare);
                    bottomHeap.limit = n;
                    bottomHeap.heapArray = this.heapArray.slice(-n);
                    return [4, bottomHeap.init()];
                  case 1:
                    _a.sent();
                    startAt = this.heapArray.length - 1 - n;
                    parentStartAt = HeapAsync2.getParentIndexOf(startAt);
                    indices = [];
                    for (i = startAt; i > parentStartAt; --i) {
                      indices.push(i);
                    }
                    arr = this.heapArray;
                    _a.label = 2;
                  case 2:
                    if (!indices.length) return [3, 6];
                    i = indices.shift();
                    return [4, this.compare(arr[i], bottomHeap.peek())];
                  case 3:
                    if (!(_a.sent() > 0)) return [3, 5];
                    return [4, bottomHeap.replace(arr[i])];
                  case 4:
                    _a.sent();
                    if (i % 2) {
                      indices.push(HeapAsync2.getParentIndexOf(i));
                    }
                    _a.label = 5;
                  case 5:
                    return [3, 2];
                  case 6:
                    return [2, bottomHeap.toArray()];
                }
              });
            });
          };
          HeapAsync2.prototype._moveNode = function(j, k) {
            var temp = this.heapArray[j];
            this.heapArray[j] = this.heapArray[k];
            this.heapArray[k] = temp;
          };
          HeapAsync2.prototype._sortNodeDown = function(i) {
            return __awaiter(this, void 0, void 0, function() {
              var length, originalIndex, value, left, right, best, _a;
              return __generator$1(this, function(_b) {
                switch (_b.label) {
                  case 0:
                    length = this.heapArray.length;
                    originalIndex = i;
                    value = this.heapArray[i];
                    left = 2 * i + 1;
                    _b.label = 1;
                  case 1:
                    if (!(left < length)) return [3, 5];
                    right = left + 1;
                    _a = right >= length;
                    if (_a) return [3, 3];
                    return [4, this.compare(this.heapArray[left], this.heapArray[right])];
                  case 2:
                    _a = _b.sent() < 0;
                    _b.label = 3;
                  case 3:
                    best = _a ? left : right;
                    return [4, this.compare(this.heapArray[best], value)];
                  case 4:
                    if (_b.sent() < 0) {
                      this.heapArray[i] = this.heapArray[best];
                      i = best;
                      left = 2 * i + 1;
                    } else
                      return [3, 5];
                    return [3, 1];
                  case 5:
                    if (i !== originalIndex) {
                      this.heapArray[i] = value;
                    }
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            });
          };
          HeapAsync2.prototype._sortNodeUp = function(i) {
            return __awaiter(this, void 0, void 0, function() {
              var value, originalIndex, pi;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    value = this.heapArray[i];
                    originalIndex = i;
                    _a.label = 1;
                  case 1:
                    if (!(i > 0)) return [3, 3];
                    pi = HeapAsync2.getParentIndexOf(i);
                    return [4, this.compare(value, this.heapArray[pi])];
                  case 2:
                    if (_a.sent() < 0) {
                      this.heapArray[i] = this.heapArray[pi];
                      i = pi;
                    } else
                      return [3, 3];
                    return [3, 1];
                  case 3:
                    if (i !== originalIndex) {
                      this.heapArray[i] = value;
                    }
                    return [
                      2
                      /*return*/
                    ];
                }
              });
            });
          };
          HeapAsync2.prototype._topN_push = function(n) {
            return __awaiter(this, void 0, void 0, function() {
              var topHeap, indices, arr, i;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    topHeap = new HeapAsync2(this._invertedCompare);
                    topHeap.limit = n;
                    indices = [0];
                    arr = this.heapArray;
                    _a.label = 1;
                  case 1:
                    if (!indices.length) return [3, 7];
                    i = indices.shift();
                    if (!(i < arr.length)) return [3, 6];
                    if (!(topHeap.length < n)) return [3, 3];
                    return [4, topHeap.push(arr[i])];
                  case 2:
                    _a.sent();
                    indices.push.apply(indices, __spreadArray$1([], __read$1(HeapAsync2.getChildrenIndexOf(i)), false));
                    return [3, 6];
                  case 3:
                    return [4, this.compare(arr[i], topHeap.peek())];
                  case 4:
                    if (!(_a.sent() < 0)) return [3, 6];
                    return [4, topHeap.replace(arr[i])];
                  case 5:
                    _a.sent();
                    indices.push.apply(indices, __spreadArray$1([], __read$1(HeapAsync2.getChildrenIndexOf(i)), false));
                    _a.label = 6;
                  case 6:
                    return [3, 1];
                  case 7:
                    return [2, topHeap.toArray()];
                }
              });
            });
          };
          HeapAsync2.prototype._topN_fill = function(n) {
            return __awaiter(this, void 0, void 0, function() {
              var heapArray, topHeap, branch, indices, i, i;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heapArray = this.heapArray;
                    topHeap = new HeapAsync2(this._invertedCompare);
                    topHeap.limit = n;
                    topHeap.heapArray = heapArray.slice(0, n);
                    return [4, topHeap.init()];
                  case 1:
                    _a.sent();
                    branch = HeapAsync2.getParentIndexOf(n - 1) + 1;
                    indices = [];
                    for (i = branch; i < n; ++i) {
                      indices.push.apply(indices, __spreadArray$1([], __read$1(HeapAsync2.getChildrenIndexOf(i).filter(function(l) {
                        return l < heapArray.length;
                      })), false));
                    }
                    if ((n - 1) % 2) {
                      indices.push(n);
                    }
                    _a.label = 2;
                  case 2:
                    if (!indices.length) return [3, 6];
                    i = indices.shift();
                    if (!(i < heapArray.length)) return [3, 5];
                    return [4, this.compare(heapArray[i], topHeap.peek())];
                  case 3:
                    if (!(_a.sent() < 0)) return [3, 5];
                    return [4, topHeap.replace(heapArray[i])];
                  case 4:
                    _a.sent();
                    indices.push.apply(indices, __spreadArray$1([], __read$1(HeapAsync2.getChildrenIndexOf(i)), false));
                    _a.label = 5;
                  case 5:
                    return [3, 2];
                  case 6:
                    return [2, topHeap.toArray()];
                }
              });
            });
          };
          HeapAsync2.prototype._topN_heap = function(n) {
            return __awaiter(this, void 0, void 0, function() {
              var topHeap, result, i, _a, _b;
              return __generator$1(this, function(_c) {
                switch (_c.label) {
                  case 0:
                    topHeap = this.clone();
                    result = [];
                    i = 0;
                    _c.label = 1;
                  case 1:
                    if (!(i < n)) return [3, 4];
                    _b = (_a = result).push;
                    return [4, topHeap.pop()];
                  case 2:
                    _b.apply(_a, [_c.sent()]);
                    _c.label = 3;
                  case 3:
                    ++i;
                    return [3, 1];
                  case 4:
                    return [2, result];
                }
              });
            });
          };
          HeapAsync2.prototype._topIdxOf = function(list) {
            return __awaiter(this, void 0, void 0, function() {
              var idx, top, i, comp;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    if (!list.length) {
                      return [2, -1];
                    }
                    idx = 0;
                    top = list[idx];
                    i = 1;
                    _a.label = 1;
                  case 1:
                    if (!(i < list.length)) return [3, 4];
                    return [4, this.compare(list[i], top)];
                  case 2:
                    comp = _a.sent();
                    if (comp < 0) {
                      idx = i;
                      top = list[i];
                    }
                    _a.label = 3;
                  case 3:
                    ++i;
                    return [3, 1];
                  case 4:
                    return [2, idx];
                }
              });
            });
          };
          HeapAsync2.prototype._topOf = function() {
            var list = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              list[_i] = arguments[_i];
            }
            return __awaiter(this, void 0, void 0, function() {
              var heap;
              return __generator$1(this, function(_a) {
                switch (_a.label) {
                  case 0:
                    heap = new HeapAsync2(this.compare);
                    return [4, heap.init(list)];
                  case 1:
                    _a.sent();
                    return [2, heap.peek()];
                }
              });
            });
          };
          return HeapAsync2;
        })()
      );
      var __generator = function(thisArg, body) {
        var _ = { label: 0, sent: function() {
          if (t[0] & 1) throw t[1];
          return t[1];
        }, trys: [], ops: [] }, f2, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
        return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
          return this;
        }), g;
        function verb(n) {
          return function(v) {
            return step([n, v]);
          };
        }
        function step(op) {
          if (f2) throw new TypeError("Generator is already executing.");
          while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f2 = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
              case 0:
              case 1:
                t = op;
                break;
              case 4:
                _.label++;
                return { value: op[1], done: false };
              case 5:
                _.label++;
                y = op[1];
                op = [0];
                continue;
              case 7:
                op = _.ops.pop();
                _.trys.pop();
                continue;
              default:
                if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                  _ = 0;
                  continue;
                }
                if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                  _.label = op[1];
                  break;
                }
                if (op[0] === 6 && _.label < t[1]) {
                  _.label = t[1];
                  t = op;
                  break;
                }
                if (t && _.label < t[2]) {
                  _.label = t[2];
                  _.ops.push(op);
                  break;
                }
                if (t[2]) _.ops.pop();
                _.trys.pop();
                continue;
            }
            op = body.call(thisArg, _);
          } catch (e) {
            op = [6, e];
            y = 0;
          } finally {
            f2 = t = 0;
          }
          if (op[0] & 5) throw op[1];
          return { value: op[0] ? op[1] : void 0, done: true };
        }
      };
      var __read = function(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
          while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        } catch (error) {
          e = { error };
        } finally {
          try {
            if (r && !r.done && (m = i["return"])) m.call(i);
          } finally {
            if (e) throw e.error;
          }
        }
        return ar;
      };
      var __spreadArray = function(to, from, pack) {
        if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
          if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
          }
        }
        return to.concat(ar || Array.prototype.slice.call(from));
      };
      var toInt = function(n) {
        return ~~n;
      };
      var Heap2 = (
        /** @class */
        (function() {
          function Heap3(compare) {
            if (compare === void 0) {
              compare = Heap3.minComparator;
            }
            var _this = this;
            this.compare = compare;
            this.heapArray = [];
            this._limit = 0;
            this.offer = this.add;
            this.element = this.peek;
            this.poll = this.pop;
            this.removeAll = this.clear;
            this._invertedCompare = function(a, b) {
              return -1 * _this.compare(a, b);
            };
          }
          Heap3.getChildrenIndexOf = function(idx) {
            return [idx * 2 + 1, idx * 2 + 2];
          };
          Heap3.getParentIndexOf = function(idx) {
            if (idx <= 0) {
              return -1;
            }
            return idx - 1 >> 1;
          };
          Heap3.getSiblingIndexOf = function(idx) {
            if (idx <= 0) {
              return -1;
            }
            var whichChildren = idx % 2 ? 1 : -1;
            return idx + whichChildren;
          };
          Heap3.minComparator = function(a, b) {
            if (a > b) {
              return 1;
            } else if (a < b) {
              return -1;
            } else {
              return 0;
            }
          };
          Heap3.maxComparator = function(a, b) {
            if (b > a) {
              return 1;
            } else if (b < a) {
              return -1;
            } else {
              return 0;
            }
          };
          Heap3.minComparatorNumber = function(a, b) {
            return a - b;
          };
          Heap3.maxComparatorNumber = function(a, b) {
            return b - a;
          };
          Heap3.defaultIsEqual = function(a, b) {
            return a === b;
          };
          Heap3.print = function(heap) {
            function deep(i2) {
              var pi = Heap3.getParentIndexOf(i2);
              return Math.floor(Math.log2(pi + 1));
            }
            function repeat(str, times) {
              var out = "";
              for (; times > 0; --times) {
                out += str;
              }
              return out;
            }
            var node = 0;
            var lines = [];
            var maxLines = deep(heap.length - 1) + 2;
            var maxLength = 0;
            while (node < heap.length) {
              var i = deep(node) + 1;
              if (node === 0) {
                i = 0;
              }
              var nodeText = String(heap.get(node));
              if (nodeText.length > maxLength) {
                maxLength = nodeText.length;
              }
              lines[i] = lines[i] || [];
              lines[i].push(nodeText);
              node += 1;
            }
            return lines.map(function(line, i2) {
              var times = Math.pow(2, maxLines - i2) - 1;
              return repeat(" ", Math.floor(times / 2) * maxLength) + line.map(function(el) {
                var half = (maxLength - el.length) / 2;
                return repeat(" ", Math.ceil(half)) + el + repeat(" ", Math.floor(half));
              }).join(repeat(" ", times * maxLength));
            }).join("\n");
          };
          Heap3.heapify = function(arr, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = arr;
            heap.init();
            return heap;
          };
          Heap3.heappop = function(heapArr, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            return heap.pop();
          };
          Heap3.heappush = function(heapArr, item, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            heap.push(item);
          };
          Heap3.heappushpop = function(heapArr, item, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            return heap.pushpop(item);
          };
          Heap3.heapreplace = function(heapArr, item, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            return heap.replace(item);
          };
          Heap3.heaptop = function(heapArr, n, compare) {
            if (n === void 0) {
              n = 1;
            }
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            return heap.top(n);
          };
          Heap3.heapbottom = function(heapArr, n, compare) {
            if (n === void 0) {
              n = 1;
            }
            var heap = new Heap3(compare);
            heap.heapArray = heapArr;
            return heap.bottom(n);
          };
          Heap3.nlargest = function(n, iterable, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = __spreadArray([], __read(iterable), false);
            heap.init();
            return heap.top(n);
          };
          Heap3.nsmallest = function(n, iterable, compare) {
            var heap = new Heap3(compare);
            heap.heapArray = __spreadArray([], __read(iterable), false);
            heap.init();
            return heap.bottom(n);
          };
          Heap3.prototype.add = function(element) {
            this._sortNodeUp(this.heapArray.push(element) - 1);
            this._applyLimit();
            return true;
          };
          Heap3.prototype.addAll = function(elements) {
            var _a;
            var i = this.length;
            (_a = this.heapArray).push.apply(_a, __spreadArray([], __read(elements), false));
            for (var l = this.length; i < l; ++i) {
              this._sortNodeUp(i);
            }
            this._applyLimit();
            return true;
          };
          Heap3.prototype.bottom = function(n) {
            if (n === void 0) {
              n = 1;
            }
            if (this.heapArray.length === 0 || n <= 0) {
              return [];
            } else if (this.heapArray.length === 1) {
              return [this.heapArray[0]];
            } else if (n >= this.heapArray.length) {
              return __spreadArray([], __read(this.heapArray), false);
            } else {
              return this._bottomN_push(~~n);
            }
          };
          Heap3.prototype.check = function() {
            var _this = this;
            return this.heapArray.find(function(el, j) {
              return !!_this.getChildrenOf(j).find(function(ch) {
                return _this.compare(el, ch) > 0;
              });
            });
          };
          Heap3.prototype.clear = function() {
            this.heapArray = [];
          };
          Heap3.prototype.clone = function() {
            var cloned = new Heap3(this.comparator());
            cloned.heapArray = this.toArray();
            cloned._limit = this._limit;
            return cloned;
          };
          Heap3.prototype.comparator = function() {
            return this.compare;
          };
          Heap3.prototype.contains = function(o, callbackFn) {
            if (callbackFn === void 0) {
              callbackFn = Heap3.defaultIsEqual;
            }
            return this.indexOf(o, callbackFn) !== -1;
          };
          Heap3.prototype.init = function(array) {
            if (array) {
              this.heapArray = __spreadArray([], __read(array), false);
            }
            for (var i = Heap3.getParentIndexOf(this.length - 1); i >= 0; --i) {
              this._sortNodeDown(i);
            }
            this._applyLimit();
          };
          Heap3.prototype.isEmpty = function() {
            return this.length === 0;
          };
          Heap3.prototype.indexOf = function(element, callbackFn) {
            if (callbackFn === void 0) {
              callbackFn = Heap3.defaultIsEqual;
            }
            if (this.heapArray.length === 0) {
              return -1;
            }
            var indexes = [];
            var currentIndex = 0;
            while (currentIndex < this.heapArray.length) {
              var currentElement = this.heapArray[currentIndex];
              if (callbackFn(currentElement, element)) {
                return currentIndex;
              } else if (this.compare(currentElement, element) <= 0) {
                indexes.push.apply(indexes, __spreadArray([], __read(Heap3.getChildrenIndexOf(currentIndex)), false));
              }
              currentIndex = indexes.shift() || this.heapArray.length;
            }
            return -1;
          };
          Heap3.prototype.indexOfEvery = function(element, callbackFn) {
            if (callbackFn === void 0) {
              callbackFn = Heap3.defaultIsEqual;
            }
            if (this.heapArray.length === 0) {
              return [];
            }
            var indexes = [];
            var foundIndexes = [];
            var currentIndex = 0;
            while (currentIndex < this.heapArray.length) {
              var currentElement = this.heapArray[currentIndex];
              if (callbackFn(currentElement, element)) {
                foundIndexes.push(currentIndex);
                indexes.push.apply(indexes, __spreadArray([], __read(Heap3.getChildrenIndexOf(currentIndex)), false));
              } else if (this.compare(currentElement, element) <= 0) {
                indexes.push.apply(indexes, __spreadArray([], __read(Heap3.getChildrenIndexOf(currentIndex)), false));
              }
              currentIndex = indexes.shift() || this.heapArray.length;
            }
            return foundIndexes;
          };
          Heap3.prototype.leafs = function() {
            if (this.heapArray.length === 0) {
              return [];
            }
            var pi = Heap3.getParentIndexOf(this.heapArray.length - 1);
            return this.heapArray.slice(pi + 1);
          };
          Object.defineProperty(Heap3.prototype, "length", {
            /**
             * Length of the heap. Aliases: {@link size}.
             * @return {Number}
             * @see size
             */
            get: function() {
              return this.heapArray.length;
            },
            enumerable: false,
            configurable: true
          });
          Object.defineProperty(Heap3.prototype, "limit", {
            /**
             * Get length limit of the heap.
             * Use {@link setLimit} or {@link limit} to set the limit.
             * @return {Number}
             * @see setLimit
             */
            get: function() {
              return this._limit;
            },
            /**
             * Set length limit of the heap. Same as using {@link setLimit}.
             * @description If the heap is longer than the limit, the needed amount of leafs are removed.
             * @param {Number} _l Limit, defaults to 0 (no limit). Negative, Infinity, or NaN values set the limit to 0.
             * @see setLimit
             */
            set: function(_l) {
              if (_l < 0 || isNaN(_l)) {
                this._limit = 0;
              } else {
                this._limit = ~~_l;
              }
              this._applyLimit();
            },
            enumerable: false,
            configurable: true
          });
          Heap3.prototype.setLimit = function(_l) {
            this.limit = _l;
            if (_l < 0 || isNaN(_l)) {
              return NaN;
            } else {
              return this._limit;
            }
          };
          Heap3.prototype.peek = function() {
            return this.heapArray[0];
          };
          Heap3.prototype.pop = function() {
            var last = this.heapArray.pop();
            if (this.length > 0 && last !== void 0) {
              return this.replace(last);
            }
            return last;
          };
          Heap3.prototype.push = function() {
            var elements = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              elements[_i] = arguments[_i];
            }
            if (elements.length < 1) {
              return false;
            } else if (elements.length === 1) {
              return this.add(elements[0]);
            } else {
              return this.addAll(elements);
            }
          };
          Heap3.prototype.pushpop = function(element) {
            var _a;
            if (this.compare(this.heapArray[0], element) < 0) {
              _a = __read([this.heapArray[0], element], 2), element = _a[0], this.heapArray[0] = _a[1];
              this._sortNodeDown(0);
            }
            return element;
          };
          Heap3.prototype.remove = function(o, callbackFn) {
            var _this = this;
            if (callbackFn === void 0) {
              callbackFn = Heap3.defaultIsEqual;
            }
            if (!this.heapArray.length)
              return false;
            if (o === void 0) {
              this.pop();
              return true;
            }
            var queue = [0];
            while (queue.length) {
              var idx = queue.shift();
              if (callbackFn(this.heapArray[idx], o)) {
                if (idx === 0) {
                  this.pop();
                } else if (idx === this.heapArray.length - 1) {
                  this.heapArray.pop();
                } else {
                  this.heapArray.splice(idx, 1, this.heapArray.pop());
                  this._sortNodeUp(idx);
                  this._sortNodeDown(idx);
                }
                return true;
              } else if (this.compare(this.heapArray[idx], o) <= 0) {
                var children = Heap3.getChildrenIndexOf(idx).filter(function(c) {
                  return c < _this.heapArray.length;
                });
                queue.push.apply(queue, __spreadArray([], __read(children), false));
              }
            }
            return false;
          };
          Heap3.prototype.replace = function(element) {
            var peek = this.heapArray[0];
            this.heapArray[0] = element;
            this._sortNodeDown(0);
            return peek;
          };
          Heap3.prototype.size = function() {
            return this.length;
          };
          Heap3.prototype.top = function(n) {
            if (n === void 0) {
              n = 1;
            }
            if (this.heapArray.length === 0 || n <= 0) {
              return [];
            } else if (this.heapArray.length === 1 || n === 1) {
              return [this.heapArray[0]];
            } else if (n >= this.heapArray.length) {
              return __spreadArray([], __read(this.heapArray), false);
            } else {
              return this._topN_push(~~n);
            }
          };
          Heap3.prototype.toArray = function() {
            return __spreadArray([], __read(this.heapArray), false);
          };
          Heap3.prototype.toString = function() {
            return this.heapArray.toString();
          };
          Heap3.prototype.get = function(i) {
            return this.heapArray[i];
          };
          Heap3.prototype.getChildrenOf = function(idx) {
            var _this = this;
            return Heap3.getChildrenIndexOf(idx).map(function(i) {
              return _this.heapArray[i];
            }).filter(function(e) {
              return e !== void 0;
            });
          };
          Heap3.prototype.getParentOf = function(idx) {
            var pi = Heap3.getParentIndexOf(idx);
            return this.heapArray[pi];
          };
          Heap3.prototype[Symbol.iterator] = function() {
            return __generator(this, function(_a) {
              switch (_a.label) {
                case 0:
                  if (!this.length) return [3, 2];
                  return [4, this.pop()];
                case 1:
                  _a.sent();
                  return [3, 0];
                case 2:
                  return [
                    2
                    /*return*/
                  ];
              }
            });
          };
          Heap3.prototype.iterator = function() {
            return this.toArray();
          };
          Heap3.prototype._applyLimit = function() {
            if (this._limit > 0 && this._limit < this.heapArray.length) {
              var rm = this.heapArray.length - this._limit;
              while (rm) {
                this.heapArray.pop();
                --rm;
              }
            }
          };
          Heap3.prototype._bottomN_push = function(n) {
            var bottomHeap = new Heap3(this.compare);
            bottomHeap.limit = n;
            bottomHeap.heapArray = this.heapArray.slice(-n);
            bottomHeap.init();
            var startAt = this.heapArray.length - 1 - n;
            var parentStartAt = Heap3.getParentIndexOf(startAt);
            var indices = [];
            for (var i = startAt; i > parentStartAt; --i) {
              indices.push(i);
            }
            var arr = this.heapArray;
            while (indices.length) {
              var i = indices.shift();
              if (this.compare(arr[i], bottomHeap.peek()) > 0) {
                bottomHeap.replace(arr[i]);
                if (i % 2) {
                  indices.push(Heap3.getParentIndexOf(i));
                }
              }
            }
            return bottomHeap.toArray();
          };
          Heap3.prototype._moveNode = function(j, k) {
            var temp = this.heapArray[j];
            this.heapArray[j] = this.heapArray[k];
            this.heapArray[k] = temp;
          };
          Heap3.prototype._sortNodeDown = function(i) {
            var length = this.heapArray.length;
            var originalIndex = i;
            var value = this.heapArray[i];
            var left = 2 * i + 1;
            while (left < length) {
              var right = left + 1;
              var best = right >= length || this.compare(this.heapArray[left], this.heapArray[right]) < 0 ? left : right;
              if (this.compare(this.heapArray[best], value) < 0) {
                this.heapArray[i] = this.heapArray[best];
                i = best;
                left = 2 * i + 1;
              } else
                break;
            }
            if (i !== originalIndex) {
              this.heapArray[i] = value;
            }
          };
          Heap3.prototype._sortNodeUp = function(i) {
            var value = this.heapArray[i];
            var originalIndex = i;
            while (i > 0) {
              var pi = Heap3.getParentIndexOf(i);
              if (this.compare(value, this.heapArray[pi]) < 0) {
                this.heapArray[i] = this.heapArray[pi];
                i = pi;
              } else
                break;
            }
            if (i !== originalIndex) {
              this.heapArray[i] = value;
            }
          };
          Heap3.prototype._topN_push = function(n) {
            var topHeap = new Heap3(this._invertedCompare);
            topHeap.limit = n;
            var indices = [0];
            var arr = this.heapArray;
            while (indices.length) {
              var i = indices.shift();
              if (i < arr.length) {
                if (topHeap.length < n) {
                  topHeap.push(arr[i]);
                  indices.push.apply(indices, __spreadArray([], __read(Heap3.getChildrenIndexOf(i)), false));
                } else if (this.compare(arr[i], topHeap.peek()) < 0) {
                  topHeap.replace(arr[i]);
                  indices.push.apply(indices, __spreadArray([], __read(Heap3.getChildrenIndexOf(i)), false));
                }
              }
            }
            return topHeap.toArray();
          };
          Heap3.prototype._topN_fill = function(n) {
            var heapArray = this.heapArray;
            var topHeap = new Heap3(this._invertedCompare);
            topHeap.limit = n;
            topHeap.heapArray = heapArray.slice(0, n);
            topHeap.init();
            var branch = Heap3.getParentIndexOf(n - 1) + 1;
            var indices = [];
            for (var i = branch; i < n; ++i) {
              indices.push.apply(indices, __spreadArray([], __read(Heap3.getChildrenIndexOf(i).filter(function(l) {
                return l < heapArray.length;
              })), false));
            }
            if ((n - 1) % 2) {
              indices.push(n);
            }
            while (indices.length) {
              var i = indices.shift();
              if (i < heapArray.length) {
                if (this.compare(heapArray[i], topHeap.peek()) < 0) {
                  topHeap.replace(heapArray[i]);
                  indices.push.apply(indices, __spreadArray([], __read(Heap3.getChildrenIndexOf(i)), false));
                }
              }
            }
            return topHeap.toArray();
          };
          Heap3.prototype._topN_heap = function(n) {
            var topHeap = this.clone();
            var result = [];
            for (var i = 0; i < n; ++i) {
              result.push(topHeap.pop());
            }
            return result;
          };
          Heap3.prototype._topIdxOf = function(list) {
            if (!list.length) {
              return -1;
            }
            var idx = 0;
            var top = list[idx];
            for (var i = 1; i < list.length; ++i) {
              var comp = this.compare(list[i], top);
              if (comp < 0) {
                idx = i;
                top = list[i];
              }
            }
            return idx;
          };
          Heap3.prototype._topOf = function() {
            var list = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              list[_i] = arguments[_i];
            }
            var heap = new Heap3(this.compare);
            heap.init(list);
            return heap.peek();
          };
          return Heap3;
        })()
      );
      exports3.Heap = Heap2;
      exports3.HeapAsync = HeapAsync;
      exports3.default = Heap2;
      exports3.toInt = toInt;
      Object.defineProperty(exports3, "__esModule", { value: true });
    }));
  }
});

// node_modules/.pnpm/@foxglove+rosmsg@5.0.5/node_modules/@foxglove/rosmsg/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg@5.0.5/node_modules/@foxglove/rosmsg/dist/index.js"(exports2, module2) {
    (() => {
      var __webpack_modules__ = {
        /***/
        91: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.buildRos2Type = buildRos2Type;
            const TYPE = String.raw`(?<type>[a-zA-Z0-9_/]+)`;
            const STRING_BOUND = String.raw`(?:<=(?<stringBound>\d+))`;
            const ARRAY_BOUND = String.raw`(?:(?<unboundedArray>\[\])|\[(?<arrayLength>\d+)\]|\[<=(?<arrayBound>\d+)\])`;
            const NAME2 = String.raw`(?<name>[a-zA-Z0-9_]+)`;
            const QUOTED_STRING = String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"`;
            const COMMENT_TERMINATED_LITERAL = String.raw`(?:${QUOTED_STRING}|(?:\\.|[^\s'"#\\])(?:\\.|[^#\\])*)`;
            const ARRAY_TERMINATED_LITERAL = String.raw`(?:${QUOTED_STRING}|(?:\\.|[^\s'"\],#\\])(?:\\.|[^\],#\\])*)`;
            const CONSTANT_ASSIGNMENT = String.raw`\s*=\s*(?<constantValue>${COMMENT_TERMINATED_LITERAL}?)`;
            const DEFAULT_VALUE_ARRAY = String.raw`\[(?:${ARRAY_TERMINATED_LITERAL},)*${ARRAY_TERMINATED_LITERAL}?\]`;
            const DEFAULT_VALUE = String.raw`(?<defaultValue>${DEFAULT_VALUE_ARRAY}|${COMMENT_TERMINATED_LITERAL})`;
            const COMMENT = String.raw`(?:#.*)`;
            const DEFINITION_LINE_REGEX = new RegExp(String.raw`^${TYPE}${STRING_BOUND}?${ARRAY_BOUND}?\s+${NAME2}(?:${CONSTANT_ASSIGNMENT}|\s+${DEFAULT_VALUE})?\s*${COMMENT}?$`);
            const STRING_ESCAPES = String.raw`\\(?<char>['"abfnrtv\\])|\\(?<oct>[0-7]{1,3})|\\x(?<hex2>[a-fA-F0-9]{2})|\\u(?<hex4>[a-fA-F0-9]{4})|\\U(?<hex8>[a-fA-F0-9]{8})`;
            const BUILTIN_TYPES = [
              "bool",
              "byte",
              "char",
              "float32",
              "float64",
              "int8",
              "uint8",
              "int16",
              "uint16",
              "int32",
              "uint32",
              "int64",
              "uint64",
              "string",
              "wstring",
              "time",
              "duration",
              "builtin_interfaces/Time",
              "builtin_interfaces/Duration",
              "builtin_interfaces/msg/Time",
              "builtin_interfaces/msg/Duration"
            ];
            function parseBigIntLiteral(str, min, max) {
              const value = BigInt(str);
              if (value < min || value > max) {
                throw new Error(`Number ${str} out of range [${min}, ${max}]`);
              }
              return value;
            }
            function parseNumberLiteral(str, min, max) {
              const value = parseInt(str);
              if (Number.isNaN(value)) {
                throw new Error(`Invalid numeric literal: ${str}`);
              }
              if (value < min || value > max) {
                throw new Error(`Number ${str} out of range [${min}, ${max}]`);
              }
              return value;
            }
            const LITERAL_REGEX = new RegExp(ARRAY_TERMINATED_LITERAL, "y");
            const COMMA_OR_END_REGEX = /\s*(,)\s*|\s*$/y;
            function parseArrayLiteral(type, rawStr) {
              if (!rawStr.startsWith("[") || !rawStr.endsWith("]")) {
                throw new Error("Array must start with [ and end with ]");
              }
              const str = rawStr.substring(1, rawStr.length - 1);
              if (type === "string" || type === "wstring") {
                const results = [];
                let offset = 0;
                while (offset < str.length) {
                  if (str[offset] === ",") {
                    throw new Error("Expected array element before comma");
                  }
                  LITERAL_REGEX.lastIndex = offset;
                  let match = LITERAL_REGEX.exec(str);
                  if (match) {
                    results.push(parseStringLiteral(match[0]));
                    offset = LITERAL_REGEX.lastIndex;
                  }
                  COMMA_OR_END_REGEX.lastIndex = offset;
                  match = COMMA_OR_END_REGEX.exec(str);
                  if (!match) {
                    throw new Error("Expected comma or end of array");
                  }
                  if (!match[1]) {
                    break;
                  }
                  offset = COMMA_OR_END_REGEX.lastIndex;
                }
                return results;
              }
              return str.split(",").map((part) => parsePrimitiveLiteral(type, part.trim()));
            }
            function parseStringLiteral(maybeQuotedStr) {
              let quoteThatMustBeEscaped = "";
              let str = maybeQuotedStr;
              for (const quote of ["'", '"']) {
                if (maybeQuotedStr.startsWith(quote)) {
                  if (!maybeQuotedStr.endsWith(quote)) {
                    throw new Error(`Expected terminating ${quote} in string literal: ${maybeQuotedStr}`);
                  }
                  quoteThatMustBeEscaped = quote;
                  str = maybeQuotedStr.substring(quote.length, maybeQuotedStr.length - quote.length);
                  break;
                }
              }
              if (
                // eslint-disable-next-line no-constant-binary-expression, @typescript-eslint/no-unnecessary-condition
                !new RegExp(String.raw`^(?:[^\\${quoteThatMustBeEscaped}]|${STRING_ESCAPES})*$`).test(str) == void 0
              ) {
                throw new Error(`Invalid string literal: ${str}`);
              }
              return str.replace(new RegExp(STRING_ESCAPES, "g"), (...args) => {
                const { char, oct, hex2, hex4, hex8 } = args[args.length - 1];
                const hex = hex2 ?? hex4 ?? hex8;
                if (char != void 0) {
                  return {
                    "'": "'",
                    '"': '"',
                    a: "\x07",
                    b: "\b",
                    f: "\f",
                    n: "\n",
                    r: "\r",
                    t: "	",
                    v: "\v",
                    "\\": "\\"
                  }[char];
                } else if (oct != void 0) {
                  return String.fromCodePoint(parseInt(oct, 8));
                } else if (hex != void 0) {
                  return String.fromCodePoint(parseInt(hex, 16));
                } else {
                  throw new Error("Expected exactly one matched group");
                }
              });
            }
            function parsePrimitiveLiteral(type, str) {
              switch (type) {
                case "bool":
                  if (["true", "True", "1"].includes(str)) {
                    return true;
                  } else if (["false", "False", "0"].includes(str)) {
                    return false;
                  }
                  break;
                case "float32":
                case "float64": {
                  const value = parseFloat(str);
                  if (!Number.isNaN(value)) {
                    return value;
                  }
                  break;
                }
                case "int8":
                  return parseNumberLiteral(str, ~127, 127);
                case "uint8":
                  return parseNumberLiteral(str, 0, 255);
                case "int16":
                  return parseNumberLiteral(str, ~32767, 32767);
                case "uint16":
                  return parseNumberLiteral(str, 0, 65535);
                case "int32":
                  return parseNumberLiteral(str, ~2147483647, 2147483647);
                case "uint32":
                  return parseNumberLiteral(str, 0, 4294967295);
                case "int64":
                  return parseBigIntLiteral(str, ~0x7fffffffffffffffn, 0x7fffffffffffffffn);
                case "uint64":
                  return parseBigIntLiteral(str, 0n, 0xffffffffffffffffn);
                case "string":
                case "wstring":
                  return parseStringLiteral(str);
              }
              throw new Error(`Invalid literal of type ${type}: ${str}`);
            }
            function normalizeType2(type) {
              switch (type) {
                case "char":
                  return "uint8";
                case "byte":
                  return "uint8";
                case "builtin_interfaces/Time":
                case "builtin_interfaces/msg/Time":
                  return "time";
                case "builtin_interfaces/Duration":
                case "builtin_interfaces/msg/Duration":
                  return "duration";
              }
              return type;
            }
            function buildRos2Type(lines) {
              const definitions = [];
              let complexTypeName;
              for (const { line } of lines) {
                let match;
                if (line.startsWith("#")) {
                  continue;
                } else if (match = /^MSG: ([^ ]+)\s*(?:#.+)?$/.exec(line)) {
                  complexTypeName = match[1];
                  continue;
                } else if (match = DEFINITION_LINE_REGEX.exec(line)) {
                  const { type: rawType, stringBound, unboundedArray, arrayLength, arrayBound, name, constantValue, defaultValue } = match.groups;
                  const type = normalizeType2(rawType);
                  if (stringBound != void 0 && type !== "string" && type !== "wstring") {
                    throw new Error(`Invalid string bound for type ${type}`);
                  }
                  if (constantValue != void 0) {
                    if (!/^[A-Z](?:_?[A-Z0-9]+)*$/.test(name)) {
                      throw new Error(`Invalid constant name: ${name}`);
                    }
                  } else {
                    if (!/^[a-z](?:_?[a-z0-9]+)*$/.test(name)) {
                      throw new Error(`Invalid field name: ${name}`);
                    }
                  }
                  const isComplex = !BUILTIN_TYPES.includes(type);
                  const isArray = unboundedArray != void 0 || arrayLength != void 0 || arrayBound != void 0;
                  definitions.push({
                    name,
                    type,
                    isComplex: constantValue != void 0 ? isComplex || void 0 : isComplex,
                    isConstant: constantValue != void 0 || void 0,
                    isArray: constantValue != void 0 ? isArray || void 0 : isArray,
                    arrayLength: arrayLength != void 0 ? parseInt(arrayLength) : void 0,
                    arrayUpperBound: arrayBound != void 0 ? parseInt(arrayBound) : void 0,
                    upperBound: stringBound != void 0 ? parseInt(stringBound) : void 0,
                    defaultValue: defaultValue != void 0 ? isArray ? parseArrayLiteral(type, defaultValue.trim()) : parsePrimitiveLiteral(type, defaultValue.trim()) : void 0,
                    value: constantValue != void 0 ? parsePrimitiveLiteral(type, constantValue.trim()) : void 0,
                    valueText: constantValue?.trim()
                  });
                } else {
                  throw new Error(`Could not parse line: '${line}'`);
                }
              }
              return { name: complexTypeName, definitions };
            }
          })
        ),
        /***/
        155: (
          /***/
          (function(__unused_webpack_module, exports3, __webpack_require__2) {
            "use strict";
            var __createBinding = this && this.__createBinding || (Object.create ? (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              var desc = Object.getOwnPropertyDescriptor(m, k);
              if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
                desc = { enumerable: true, get: function() {
                  return m[k];
                } };
              }
              Object.defineProperty(o, k2, desc);
            }) : (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              o[k2] = m[k];
            }));
            var __exportStar = this && this.__exportStar || function(m, exports4) {
              for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports4, p)) __createBinding(exports4, m, p);
            };
            Object.defineProperty(exports3, "__esModule", { value: true });
            __exportStar(__webpack_require__2(498), exports3);
            __exportStar(__webpack_require__2(900), exports3);
          })
        ),
        /***/
        425: (
          /***/
          ((__unused_webpack_module, exports3, __webpack_require__2) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.md5 = md5;
            const md5_typescript_1 = __webpack_require__2(479);
            const BUILTIN_TYPES = /* @__PURE__ */ new Set([
              "int8",
              "uint8",
              "int16",
              "uint16",
              "int32",
              "uint32",
              "int64",
              "uint64",
              "float32",
              "float64",
              "string",
              "bool",
              "char",
              "byte",
              "time",
              "duration"
            ]);
            function md5(msgDefs) {
              if (msgDefs.length === 0) {
                throw new Error(`Cannot produce md5sum for empty msgDefs`);
              }
              const subMsgDefs = /* @__PURE__ */ new Map();
              for (const msgDef of msgDefs) {
                if (msgDef.name != void 0) {
                  subMsgDefs.set(msgDef.name, msgDef);
                }
              }
              const first = msgDefs[0];
              return computeMessageMd5(first, subMsgDefs);
            }
            function computeMessageMd5(msgDef, subMsgDefs) {
              let output = "";
              const constants = msgDef.definitions.filter(({ isConstant }) => isConstant);
              const variables = msgDef.definitions.filter(({ isConstant }) => isConstant == void 0 || !isConstant);
              for (const def of constants) {
                output += `${def.type} ${def.name}=${def.valueText ?? String(def.value)}
`;
              }
              for (const def of variables) {
                if (isBuiltin(def.type)) {
                  const arrayLength = def.arrayLength != void 0 ? String(def.arrayLength) : "";
                  const array = def.isArray === true ? `[${arrayLength}]` : "";
                  output += `${def.type}${array} ${def.name}
`;
                } else {
                  const subMsgDef = subMsgDefs.get(def.type);
                  if (subMsgDef == void 0) {
                    throw new Error(`Missing definition for submessage type "${def.type}"`);
                  }
                  const subMd5 = computeMessageMd5(subMsgDef, subMsgDefs);
                  output += `${subMd5} ${def.name}
`;
                }
              }
              output = output.trimEnd();
              return md5_typescript_1.Md5.init(output);
            }
            function isBuiltin(typeName) {
              return BUILTIN_TYPES.has(typeName);
            }
          })
        ),
        /***/
        479: (
          /***/
          ((__unused_webpack_module, __webpack_exports__2, __webpack_require__2) => {
            "use strict";
            __webpack_require__2.r(__webpack_exports__2);
            __webpack_require__2.d(__webpack_exports__2, {
              /* harmony export */
              Md5: () => (
                /* binding */
                Md5
              )
              /* harmony export */
            });
            var Md5 = (
              /** @class */
              (function() {
                function Md52() {
                }
                Md52.AddUnsigned = function(lX, lY) {
                  var lX4, lY4, lX8, lY8, lResult;
                  lX8 = lX & 2147483648;
                  lY8 = lY & 2147483648;
                  lX4 = lX & 1073741824;
                  lY4 = lY & 1073741824;
                  lResult = (lX & 1073741823) + (lY & 1073741823);
                  if (!!(lX4 & lY4)) {
                    return lResult ^ 2147483648 ^ lX8 ^ lY8;
                  }
                  if (!!(lX4 | lY4)) {
                    if (!!(lResult & 1073741824)) {
                      return lResult ^ 3221225472 ^ lX8 ^ lY8;
                    } else {
                      return lResult ^ 1073741824 ^ lX8 ^ lY8;
                    }
                  } else {
                    return lResult ^ lX8 ^ lY8;
                  }
                };
                Md52.FF = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.F(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.GG = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.G(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.HH = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.H(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.II = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.I(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.ConvertToWordArray = function(string) {
                  var lWordCount, lMessageLength = string.length, lNumberOfWords_temp1 = lMessageLength + 8, lNumberOfWords_temp2 = (lNumberOfWords_temp1 - lNumberOfWords_temp1 % 64) / 64, lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16, lWordArray = Array(lNumberOfWords - 1), lBytePosition = 0, lByteCount = 0;
                  while (lByteCount < lMessageLength) {
                    lWordCount = (lByteCount - lByteCount % 4) / 4;
                    lBytePosition = lByteCount % 4 * 8;
                    lWordArray[lWordCount] = lWordArray[lWordCount] | string.charCodeAt(lByteCount) << lBytePosition;
                    lByteCount++;
                  }
                  lWordCount = (lByteCount - lByteCount % 4) / 4;
                  lBytePosition = lByteCount % 4 * 8;
                  lWordArray[lWordCount] = lWordArray[lWordCount] | 128 << lBytePosition;
                  lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
                  lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
                  return lWordArray;
                };
                Md52.WordToHex = function(lValue) {
                  var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
                  for (lCount = 0; lCount <= 3; lCount++) {
                    lByte = lValue >>> lCount * 8 & 255;
                    WordToHexValue_temp = "0" + lByte.toString(16);
                    WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
                  }
                  return WordToHexValue;
                };
                Md52.Utf8Encode = function(string) {
                  var utftext = "", c;
                  string = string.replace(/\r\n/g, "\n");
                  for (var n = 0; n < string.length; n++) {
                    c = string.charCodeAt(n);
                    if (c < 128) {
                      utftext += String.fromCharCode(c);
                    } else if (c > 127 && c < 2048) {
                      utftext += String.fromCharCode(c >> 6 | 192);
                      utftext += String.fromCharCode(c & 63 | 128);
                    } else {
                      utftext += String.fromCharCode(c >> 12 | 224);
                      utftext += String.fromCharCode(c >> 6 & 63 | 128);
                      utftext += String.fromCharCode(c & 63 | 128);
                    }
                  }
                  return utftext;
                };
                Md52.init = function(string) {
                  var temp;
                  if (typeof string !== "string")
                    string = JSON.stringify(string);
                  this._string = this.Utf8Encode(string);
                  this.x = this.ConvertToWordArray(this._string);
                  this.a = 1732584193;
                  this.b = 4023233417;
                  this.c = 2562383102;
                  this.d = 271733878;
                  for (this.k = 0; this.k < this.x.length; this.k += 16) {
                    this.AA = this.a;
                    this.BB = this.b;
                    this.CC = this.c;
                    this.DD = this.d;
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k], this.S11, 3614090360);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 1], this.S12, 3905402710);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 2], this.S13, 606105819);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 3], this.S14, 3250441966);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 4], this.S11, 4118548399);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 5], this.S12, 1200080426);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 6], this.S13, 2821735955);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 7], this.S14, 4249261313);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 8], this.S11, 1770035416);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 9], this.S12, 2336552879);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 10], this.S13, 4294925233);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 11], this.S14, 2304563134);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 12], this.S11, 1804603682);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 13], this.S12, 4254626195);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 14], this.S13, 2792965006);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 15], this.S14, 1236535329);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 1], this.S21, 4129170786);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 6], this.S22, 3225465664);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 11], this.S23, 643717713);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k], this.S24, 3921069994);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 5], this.S21, 3593408605);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 10], this.S22, 38016083);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 15], this.S23, 3634488961);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 4], this.S24, 3889429448);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 9], this.S21, 568446438);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 14], this.S22, 3275163606);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 3], this.S23, 4107603335);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 8], this.S24, 1163531501);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 13], this.S21, 2850285829);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 2], this.S22, 4243563512);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 7], this.S23, 1735328473);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 12], this.S24, 2368359562);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 5], this.S31, 4294588738);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 8], this.S32, 2272392833);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 11], this.S33, 1839030562);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 14], this.S34, 4259657740);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 1], this.S31, 2763975236);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 4], this.S32, 1272893353);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 7], this.S33, 4139469664);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 10], this.S34, 3200236656);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 13], this.S31, 681279174);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k], this.S32, 3936430074);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 3], this.S33, 3572445317);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 6], this.S34, 76029189);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 9], this.S31, 3654602809);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 12], this.S32, 3873151461);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 15], this.S33, 530742520);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 2], this.S34, 3299628645);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k], this.S41, 4096336452);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 7], this.S42, 1126891415);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 14], this.S43, 2878612391);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 5], this.S44, 4237533241);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 12], this.S41, 1700485571);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 3], this.S42, 2399980690);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 10], this.S43, 4293915773);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 1], this.S44, 2240044497);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 8], this.S41, 1873313359);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 15], this.S42, 4264355552);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 6], this.S43, 2734768916);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 13], this.S44, 1309151649);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 4], this.S41, 4149444226);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 11], this.S42, 3174756917);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 2], this.S43, 718787259);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 9], this.S44, 3951481745);
                    this.a = this.AddUnsigned(this.a, this.AA);
                    this.b = this.AddUnsigned(this.b, this.BB);
                    this.c = this.AddUnsigned(this.c, this.CC);
                    this.d = this.AddUnsigned(this.d, this.DD);
                  }
                  temp = this.WordToHex(this.a) + this.WordToHex(this.b) + this.WordToHex(this.c) + this.WordToHex(this.d);
                  return temp.toLowerCase();
                };
                Md52.x = Array();
                Md52.S11 = 7;
                Md52.S12 = 12;
                Md52.S13 = 17;
                Md52.S14 = 22;
                Md52.S21 = 5;
                Md52.S22 = 9;
                Md52.S23 = 14;
                Md52.S24 = 20;
                Md52.S31 = 4;
                Md52.S32 = 11;
                Md52.S33 = 16;
                Md52.S34 = 23;
                Md52.S41 = 6;
                Md52.S42 = 10;
                Md52.S43 = 15;
                Md52.S44 = 21;
                Md52.RotateLeft = function(lValue, iShiftBits) {
                  return lValue << iShiftBits | lValue >>> 32 - iShiftBits;
                };
                Md52.F = function(x, y, z) {
                  return x & y | ~x & z;
                };
                Md52.G = function(x, y, z) {
                  return x & z | y & ~z;
                };
                Md52.H = function(x, y, z) {
                  return x ^ y ^ z;
                };
                Md52.I = function(x, y, z) {
                  return y ^ (x | ~z);
                };
                return Md52;
              })()
            );
          })
        ),
        /***/
        498: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
          })
        ),
        /***/
        662: (
          /***/
          (function(module3) {
            (function(root, factory) {
              if (module3.exports) {
                module3.exports = factory();
              } else {
                root.nearley = factory();
              }
            })(this, function() {
              function Rule(name, symbols, postprocess) {
                this.id = ++Rule.highestId;
                this.name = name;
                this.symbols = symbols;
                this.postprocess = postprocess;
                return this;
              }
              Rule.highestId = 0;
              Rule.prototype.toString = function(withCursorAt) {
                var symbolSequence = typeof withCursorAt === "undefined" ? this.symbols.map(getSymbolShortDisplay).join(" ") : this.symbols.slice(0, withCursorAt).map(getSymbolShortDisplay).join(" ") + " \u25CF " + this.symbols.slice(withCursorAt).map(getSymbolShortDisplay).join(" ");
                return this.name + " \u2192 " + symbolSequence;
              };
              function State(rule, dot, reference, wantedBy) {
                this.rule = rule;
                this.dot = dot;
                this.reference = reference;
                this.data = [];
                this.wantedBy = wantedBy;
                this.isComplete = this.dot === rule.symbols.length;
              }
              State.prototype.toString = function() {
                return "{" + this.rule.toString(this.dot) + "}, from: " + (this.reference || 0);
              };
              State.prototype.nextState = function(child) {
                var state = new State(this.rule, this.dot + 1, this.reference, this.wantedBy);
                state.left = this;
                state.right = child;
                if (state.isComplete) {
                  state.data = state.build();
                  state.right = void 0;
                }
                return state;
              };
              State.prototype.build = function() {
                var children = [];
                var node = this;
                do {
                  children.push(node.right.data);
                  node = node.left;
                } while (node.left);
                children.reverse();
                return children;
              };
              State.prototype.finish = function() {
                if (this.rule.postprocess) {
                  this.data = this.rule.postprocess(this.data, this.reference, Parser.fail);
                }
              };
              function Column(grammar, index) {
                this.grammar = grammar;
                this.index = index;
                this.states = [];
                this.wants = {};
                this.scannable = [];
                this.completed = {};
              }
              Column.prototype.process = function(nextColumn) {
                var states = this.states;
                var wants = this.wants;
                var completed = this.completed;
                for (var w = 0; w < states.length; w++) {
                  var state = states[w];
                  if (state.isComplete) {
                    state.finish();
                    if (state.data !== Parser.fail) {
                      var wantedBy = state.wantedBy;
                      for (var i = wantedBy.length; i--; ) {
                        var left = wantedBy[i];
                        this.complete(left, state);
                      }
                      if (state.reference === this.index) {
                        var exp = state.rule.name;
                        (this.completed[exp] = this.completed[exp] || []).push(state);
                      }
                    }
                  } else {
                    var exp = state.rule.symbols[state.dot];
                    if (typeof exp !== "string") {
                      this.scannable.push(state);
                      continue;
                    }
                    if (wants[exp]) {
                      wants[exp].push(state);
                      if (completed.hasOwnProperty(exp)) {
                        var nulls = completed[exp];
                        for (var i = 0; i < nulls.length; i++) {
                          var right = nulls[i];
                          this.complete(state, right);
                        }
                      }
                    } else {
                      wants[exp] = [state];
                      this.predict(exp);
                    }
                  }
                }
              };
              Column.prototype.predict = function(exp) {
                var rules = this.grammar.byName[exp] || [];
                for (var i = 0; i < rules.length; i++) {
                  var r = rules[i];
                  var wantedBy = this.wants[exp];
                  var s = new State(r, 0, this.index, wantedBy);
                  this.states.push(s);
                }
              };
              Column.prototype.complete = function(left, right) {
                var copy = left.nextState(right);
                this.states.push(copy);
              };
              function Grammar(rules, start) {
                this.rules = rules;
                this.start = start || this.rules[0].name;
                var byName = this.byName = {};
                this.rules.forEach(function(rule) {
                  if (!byName.hasOwnProperty(rule.name)) {
                    byName[rule.name] = [];
                  }
                  byName[rule.name].push(rule);
                });
              }
              Grammar.fromCompiled = function(rules, start) {
                var lexer = rules.Lexer;
                if (rules.ParserStart) {
                  start = rules.ParserStart;
                  rules = rules.ParserRules;
                }
                var rules = rules.map(function(r) {
                  return new Rule(r.name, r.symbols, r.postprocess);
                });
                var g = new Grammar(rules, start);
                g.lexer = lexer;
                return g;
              };
              function StreamLexer() {
                this.reset("");
              }
              StreamLexer.prototype.reset = function(data, state) {
                this.buffer = data;
                this.index = 0;
                this.line = state ? state.line : 1;
                this.lastLineBreak = state ? -state.col : 0;
              };
              StreamLexer.prototype.next = function() {
                if (this.index < this.buffer.length) {
                  var ch = this.buffer[this.index++];
                  if (ch === "\n") {
                    this.line += 1;
                    this.lastLineBreak = this.index;
                  }
                  return { value: ch };
                }
              };
              StreamLexer.prototype.save = function() {
                return {
                  line: this.line,
                  col: this.index - this.lastLineBreak
                };
              };
              StreamLexer.prototype.formatError = function(token, message) {
                var buffer = this.buffer;
                if (typeof buffer === "string") {
                  var lines = buffer.split("\n").slice(
                    Math.max(0, this.line - 5),
                    this.line
                  );
                  var nextLineBreak = buffer.indexOf("\n", this.index);
                  if (nextLineBreak === -1) nextLineBreak = buffer.length;
                  var col = this.index - this.lastLineBreak;
                  var lastLineDigits = String(this.line).length;
                  message += " at line " + this.line + " col " + col + ":\n\n";
                  message += lines.map(function(line, i) {
                    return pad(this.line - lines.length + i + 1, lastLineDigits) + " " + line;
                  }, this).join("\n");
                  message += "\n" + pad("", lastLineDigits + col) + "^\n";
                  return message;
                } else {
                  return message + " at index " + (this.index - 1);
                }
                function pad(n, length) {
                  var s = String(n);
                  return Array(length - s.length + 1).join(" ") + s;
                }
              };
              function Parser(rules, start, options) {
                if (rules instanceof Grammar) {
                  var grammar = rules;
                  var options = start;
                } else {
                  var grammar = Grammar.fromCompiled(rules, start);
                }
                this.grammar = grammar;
                this.options = {
                  keepHistory: false,
                  lexer: grammar.lexer || new StreamLexer()
                };
                for (var key in options || {}) {
                  this.options[key] = options[key];
                }
                this.lexer = this.options.lexer;
                this.lexerState = void 0;
                var column = new Column(grammar, 0);
                var table = this.table = [column];
                column.wants[grammar.start] = [];
                column.predict(grammar.start);
                column.process();
                this.current = 0;
              }
              Parser.fail = {};
              Parser.prototype.feed = function(chunk) {
                var lexer = this.lexer;
                lexer.reset(chunk, this.lexerState);
                var token;
                while (true) {
                  try {
                    token = lexer.next();
                    if (!token) {
                      break;
                    }
                  } catch (e) {
                    var nextColumn = new Column(this.grammar, this.current + 1);
                    this.table.push(nextColumn);
                    var err2 = new Error(this.reportLexerError(e));
                    err2.offset = this.current;
                    err2.token = e.token;
                    throw err2;
                  }
                  var column = this.table[this.current];
                  if (!this.options.keepHistory) {
                    delete this.table[this.current - 1];
                  }
                  var n = this.current + 1;
                  var nextColumn = new Column(this.grammar, n);
                  this.table.push(nextColumn);
                  var literal = token.text !== void 0 ? token.text : token.value;
                  var value = lexer.constructor === StreamLexer ? token.value : token;
                  var scannable = column.scannable;
                  for (var w = scannable.length; w--; ) {
                    var state = scannable[w];
                    var expect = state.rule.symbols[state.dot];
                    if (expect.test ? expect.test(value) : expect.type ? expect.type === token.type : expect.literal === literal) {
                      var next = state.nextState({ data: value, token, isToken: true, reference: n - 1 });
                      nextColumn.states.push(next);
                    }
                  }
                  nextColumn.process();
                  if (nextColumn.states.length === 0) {
                    var err2 = new Error(this.reportError(token));
                    err2.offset = this.current;
                    err2.token = token;
                    throw err2;
                  }
                  if (this.options.keepHistory) {
                    column.lexerState = lexer.save();
                  }
                  this.current++;
                }
                if (column) {
                  this.lexerState = lexer.save();
                }
                this.results = this.finish();
                return this;
              };
              Parser.prototype.reportLexerError = function(lexerError) {
                var tokenDisplay, lexerMessage;
                var token = lexerError.token;
                if (token) {
                  tokenDisplay = "input " + JSON.stringify(token.text[0]) + " (lexer error)";
                  lexerMessage = this.lexer.formatError(token, "Syntax error");
                } else {
                  tokenDisplay = "input (lexer error)";
                  lexerMessage = lexerError.message;
                }
                return this.reportErrorCommon(lexerMessage, tokenDisplay);
              };
              Parser.prototype.reportError = function(token) {
                var tokenDisplay = (token.type ? token.type + " token: " : "") + JSON.stringify(token.value !== void 0 ? token.value : token);
                var lexerMessage = this.lexer.formatError(token, "Syntax error");
                return this.reportErrorCommon(lexerMessage, tokenDisplay);
              };
              Parser.prototype.reportErrorCommon = function(lexerMessage, tokenDisplay) {
                var lines = [];
                lines.push(lexerMessage);
                var lastColumnIndex = this.table.length - 2;
                var lastColumn = this.table[lastColumnIndex];
                var expectantStates = lastColumn.states.filter(function(state) {
                  var nextSymbol = state.rule.symbols[state.dot];
                  return nextSymbol && typeof nextSymbol !== "string";
                });
                if (expectantStates.length === 0) {
                  lines.push("Unexpected " + tokenDisplay + ". I did not expect any more input. Here is the state of my parse table:\n");
                  this.displayStateStack(lastColumn.states, lines);
                } else {
                  lines.push("Unexpected " + tokenDisplay + ". Instead, I was expecting to see one of the following:\n");
                  var stateStacks = expectantStates.map(function(state) {
                    return this.buildFirstStateStack(state, []) || [state];
                  }, this);
                  stateStacks.forEach(function(stateStack) {
                    var state = stateStack[0];
                    var nextSymbol = state.rule.symbols[state.dot];
                    var symbolDisplay = this.getSymbolDisplay(nextSymbol);
                    lines.push("A " + symbolDisplay + " based on:");
                    this.displayStateStack(stateStack, lines);
                  }, this);
                }
                lines.push("");
                return lines.join("\n");
              };
              Parser.prototype.displayStateStack = function(stateStack, lines) {
                var lastDisplay;
                var sameDisplayCount = 0;
                for (var j = 0; j < stateStack.length; j++) {
                  var state = stateStack[j];
                  var display = state.rule.toString(state.dot);
                  if (display === lastDisplay) {
                    sameDisplayCount++;
                  } else {
                    if (sameDisplayCount > 0) {
                      lines.push("    ^ " + sameDisplayCount + " more lines identical to this");
                    }
                    sameDisplayCount = 0;
                    lines.push("    " + display);
                  }
                  lastDisplay = display;
                }
              };
              Parser.prototype.getSymbolDisplay = function(symbol) {
                return getSymbolLongDisplay(symbol);
              };
              Parser.prototype.buildFirstStateStack = function(state, visited) {
                if (visited.indexOf(state) !== -1) {
                  return null;
                }
                if (state.wantedBy.length === 0) {
                  return [state];
                }
                var prevState = state.wantedBy[0];
                var childVisited = [state].concat(visited);
                var childResult = this.buildFirstStateStack(prevState, childVisited);
                if (childResult === null) {
                  return null;
                }
                return [state].concat(childResult);
              };
              Parser.prototype.save = function() {
                var column = this.table[this.current];
                column.lexerState = this.lexerState;
                return column;
              };
              Parser.prototype.restore = function(column) {
                var index = column.index;
                this.current = index;
                this.table[index] = column;
                this.table.splice(index + 1);
                this.lexerState = column.lexerState;
                this.results = this.finish();
              };
              Parser.prototype.rewind = function(index) {
                if (!this.options.keepHistory) {
                  throw new Error("set option `keepHistory` to enable rewinding");
                }
                this.restore(this.table[index]);
              };
              Parser.prototype.finish = function() {
                var considerations = [];
                var start = this.grammar.start;
                var column = this.table[this.table.length - 1];
                column.states.forEach(function(t) {
                  if (t.rule.name === start && t.dot === t.rule.symbols.length && t.reference === 0 && t.data !== Parser.fail) {
                    considerations.push(t);
                  }
                });
                return considerations.map(function(c) {
                  return c.data;
                });
              };
              function getSymbolLongDisplay(symbol) {
                var type = typeof symbol;
                if (type === "string") {
                  return symbol;
                } else if (type === "object") {
                  if (symbol.literal) {
                    return JSON.stringify(symbol.literal);
                  } else if (symbol instanceof RegExp) {
                    return "character matching " + symbol;
                  } else if (symbol.type) {
                    return symbol.type + " token";
                  } else if (symbol.test) {
                    return "token matching " + String(symbol.test);
                  } else {
                    throw new Error("Unknown symbol type: " + symbol);
                  }
                }
              }
              function getSymbolShortDisplay(symbol) {
                var type = typeof symbol;
                if (type === "string") {
                  return symbol;
                } else if (type === "object") {
                  if (symbol.literal) {
                    return JSON.stringify(symbol.literal);
                  } else if (symbol instanceof RegExp) {
                    return symbol.toString();
                  } else if (symbol.type) {
                    return "%" + symbol.type;
                  } else if (symbol.test) {
                    return "<" + String(symbol.test) + ">";
                  } else {
                    throw new Error("Unknown symbol type: " + symbol);
                  }
                }
              }
              return {
                Parser,
                Grammar,
                Rule
              };
            });
          })
        ),
        /***/
        666: (
          /***/
          ((module3, __unused_webpack_exports, __webpack_require__2) => {
            (function() {
              function id(x) {
                return x[0];
              }
              const moo = __webpack_require__2(694);
              const lexer = moo.compile({
                space: { match: /\s+/, lineBreaks: true },
                number: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\b/,
                comment: /#[^\n]*/,
                "[": "[",
                "]": "]",
                assignment: /=[^\n]*/,
                // Leading underscores are disallowed in field names, while constant names have no explicit restrictions.
                // So we are more lenient in lexing here, and the validation steps below are more strict.
                // See: https://github.com/ros/genmsg/blob/7d8b6ce6f43b6e39ea8261125d270f2d3062356f/src/genmsg/msg_loader.py#L188-L238
                fieldOrType: /[a-zA-Z_][a-zA-Z0-9_]*(?:\/[a-zA-Z][a-zA-Z0-9_]*)?/
              });
              function extend(objs) {
                return objs.reduce((r, p) => ({ ...r, ...p }), {});
              }
              var grammar = {
                Lexer: lexer,
                ParserRules: [
                  { "name": "main$ebnf$1", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "boolType", "arrayType", "__", "field", "_", "main$ebnf$1", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$2", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$2", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "bigintType", "arrayType", "__", "field", "_", "main$ebnf$2", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$3", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$3", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "numericType", "arrayType", "__", "field", "_", "main$ebnf$3", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$4", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$4", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "stringType", "arrayType", "__", "field", "_", "main$ebnf$4", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$5", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$5", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "timeType", "arrayType", "__", "field", "_", "main$ebnf$5", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$6", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$6", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "customType", "arrayType", "__", "field", "_", "main$ebnf$6", "complex"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$7", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$7", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "boolType", "__", "constantField", "_", "boolConstantValue", "_", "main$ebnf$7"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$8", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$8", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "bigintType", "__", "constantField", "_", "bigintConstantValue", "_", "main$ebnf$8"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$9", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$9", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "numericType", "__", "constantField", "_", "numericConstantValue", "_", "main$ebnf$9"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$10", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$10", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "stringType", "__", "constantField", "_", "stringConstantValue", "_", "main$ebnf$10"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main", "symbols": ["comment"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["blankLine"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "boolType", "symbols": [{ "literal": "bool" }], "postprocess": function(d) {
                    return { type: d[0].value };
                  } },
                  { "name": "bigintType$subexpression$1", "symbols": [{ "literal": "int64" }] },
                  { "name": "bigintType$subexpression$1", "symbols": [{ "literal": "uint64" }] },
                  { "name": "bigintType", "symbols": ["bigintType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "byte" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "char" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "float32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "float64" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint32" }] },
                  { "name": "numericType", "symbols": ["numericType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "stringType", "symbols": [{ "literal": "string" }], "postprocess": function(d) {
                    return { type: d[0].value };
                  } },
                  { "name": "timeType$subexpression$1", "symbols": [{ "literal": "time" }] },
                  { "name": "timeType$subexpression$1", "symbols": [{ "literal": "duration" }] },
                  { "name": "timeType", "symbols": ["timeType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "customType", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const PRIMITIVE_TYPES = ["bool", "byte", "char", "float32", "float64", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "string", "time", "duration"];
                    const type = d[0].value;
                    if (PRIMITIVE_TYPES.includes(type)) return reject;
                    return { type };
                  } },
                  { "name": "arrayType", "symbols": [{ "literal": "[" }, "_", { "literal": "]" }], "postprocess": function(d) {
                    return { isArray: true };
                  } },
                  { "name": "arrayType", "symbols": [{ "literal": "[" }, "_", "number", "_", { "literal": "]" }], "postprocess": function(d) {
                    return { isArray: true, arrayLength: d[2] };
                  } },
                  { "name": "arrayType", "symbols": ["_"], "postprocess": function(d) {
                    return { isArray: false };
                  } },
                  { "name": "field", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const name = d[0].value;
                    if (name.match(/^[a-zA-Z][a-zA-Z0-9_]*$/) == void 0) return reject;
                    return { name };
                  } },
                  { "name": "constantField", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const name = d[0].value;
                    if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) == void 0) return reject;
                    return { name, isConstant: true };
                  } },
                  { "name": "boolConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    if (valueText === "True" || valueText === "1") return { value: true, valueText };
                    if (valueText === "False" || valueText === "0") return { value: false, valueText };
                    return reject;
                  } },
                  { "name": "numericConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    const value = parseFloat(valueText);
                    return !isNaN(value) ? { value, valueText } : reject;
                  } },
                  { "name": "bigintConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    try {
                      const value = BigInt(valueText);
                      return { value, valueText };
                    } catch {
                      return reject;
                    }
                  } },
                  { "name": "stringConstantValue", "symbols": ["assignment"], "postprocess": function(d) {
                    return { value: d[0], valueText: d[0] };
                  } },
                  { "name": "bool$subexpression$1", "symbols": [{ "literal": "True" }] },
                  { "name": "bool$subexpression$1", "symbols": [{ "literal": "1" }] },
                  { "name": "bool", "symbols": ["bool$subexpression$1"], "postprocess": function(d) {
                    return true;
                  } },
                  { "name": "bool$subexpression$2", "symbols": [{ "literal": "False" }] },
                  { "name": "bool$subexpression$2", "symbols": [{ "literal": "0" }] },
                  { "name": "bool", "symbols": ["bool$subexpression$2"], "postprocess": function(d) {
                    return false;
                  } },
                  { "name": "number", "symbols": [lexer.has("number") ? { type: "number" } : number], "postprocess": function(d) {
                    return parseFloat(d[0].value);
                  } },
                  { "name": "assignment", "symbols": [lexer.has("assignment") ? { type: "assignment" } : assignment], "postprocess": function(d) {
                    return d[0].value.substr(1).trim();
                  } },
                  { "name": "comment", "symbols": [lexer.has("comment") ? { type: "comment" } : comment], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "blankLine", "symbols": ["_"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "_$subexpression$1", "symbols": [] },
                  { "name": "_$subexpression$1", "symbols": [lexer.has("space") ? { type: "space" } : space] },
                  { "name": "_", "symbols": ["_$subexpression$1"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "__", "symbols": [lexer.has("space") ? { type: "space" } : space], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "simple", "symbols": [], "postprocess": function() {
                    return { isComplex: false };
                  } },
                  { "name": "complex", "symbols": [], "postprocess": function() {
                    return { isComplex: true };
                  } }
                ],
                ParserStart: "main"
              };
              if (typeof module3.exports !== "undefined") {
                module3.exports = grammar;
              } else {
                window.grammar = grammar;
              }
            })();
          })
        ),
        /***/
        694: (
          /***/
          (function(module3, exports3) {
            var __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;
            (function(root, factory) {
              if (true) {
                !(__WEBPACK_AMD_DEFINE_ARRAY__ = [], __WEBPACK_AMD_DEFINE_FACTORY__ = factory, __WEBPACK_AMD_DEFINE_RESULT__ = typeof __WEBPACK_AMD_DEFINE_FACTORY__ === "function" ? __WEBPACK_AMD_DEFINE_FACTORY__.apply(exports3, __WEBPACK_AMD_DEFINE_ARRAY__) : __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_RESULT__ !== void 0 && (module3.exports = __WEBPACK_AMD_DEFINE_RESULT__));
              } else {
              }
            })(this, function() {
              "use strict";
              var hasOwnProperty = Object.prototype.hasOwnProperty;
              var toString = Object.prototype.toString;
              var hasSticky = typeof new RegExp().sticky === "boolean";
              function isRegExp(o) {
                return o && toString.call(o) === "[object RegExp]";
              }
              function isObject2(o) {
                return o && typeof o === "object" && !isRegExp(o) && !Array.isArray(o);
              }
              function reEscape(s) {
                return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
              }
              function reGroups(s) {
                var re = new RegExp("|" + s);
                return re.exec("").length - 1;
              }
              function reCapture(s) {
                return "(" + s + ")";
              }
              function reUnion(regexps) {
                if (!regexps.length) return "(?!)";
                var source = regexps.map(function(s) {
                  return "(?:" + s + ")";
                }).join("|");
                return "(?:" + source + ")";
              }
              function regexpOrLiteral(obj) {
                if (typeof obj === "string") {
                  return "(?:" + reEscape(obj) + ")";
                } else if (isRegExp(obj)) {
                  if (obj.ignoreCase) throw new Error("RegExp /i flag not allowed");
                  if (obj.global) throw new Error("RegExp /g flag is implied");
                  if (obj.sticky) throw new Error("RegExp /y flag is implied");
                  if (obj.multiline) throw new Error("RegExp /m flag is implied");
                  return obj.source;
                } else {
                  throw new Error("Not a pattern: " + obj);
                }
              }
              function pad(s, length) {
                if (s.length > length) {
                  return s;
                }
                return Array(length - s.length + 1).join(" ") + s;
              }
              function lastNLines(string, numLines) {
                var position = string.length;
                var lineBreaks = 0;
                while (true) {
                  var idx = string.lastIndexOf("\n", position - 1);
                  if (idx === -1) {
                    break;
                  } else {
                    lineBreaks++;
                  }
                  position = idx;
                  if (lineBreaks === numLines) {
                    break;
                  }
                  if (position === 0) {
                    break;
                  }
                }
                var startPosition = lineBreaks < numLines ? 0 : position + 1;
                return string.substring(startPosition).split("\n");
              }
              function objectToRules(object) {
                var keys = Object.getOwnPropertyNames(object);
                var result = [];
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  var thing = object[key];
                  var rules = [].concat(thing);
                  if (key === "include") {
                    for (var j = 0; j < rules.length; j++) {
                      result.push({ include: rules[j] });
                    }
                    continue;
                  }
                  var match = [];
                  rules.forEach(function(rule) {
                    if (isObject2(rule)) {
                      if (match.length) result.push(ruleOptions(key, match));
                      result.push(ruleOptions(key, rule));
                      match = [];
                    } else {
                      match.push(rule);
                    }
                  });
                  if (match.length) result.push(ruleOptions(key, match));
                }
                return result;
              }
              function arrayToRules(array) {
                var result = [];
                for (var i = 0; i < array.length; i++) {
                  var obj = array[i];
                  if (obj.include) {
                    var include = [].concat(obj.include);
                    for (var j = 0; j < include.length; j++) {
                      result.push({ include: include[j] });
                    }
                    continue;
                  }
                  if (!obj.type) {
                    throw new Error("Rule has no type: " + JSON.stringify(obj));
                  }
                  result.push(ruleOptions(obj.type, obj));
                }
                return result;
              }
              function ruleOptions(type, obj) {
                if (!isObject2(obj)) {
                  obj = { match: obj };
                }
                if (obj.include) {
                  throw new Error("Matching rules cannot also include states");
                }
                var options = {
                  defaultType: type,
                  lineBreaks: !!obj.error || !!obj.fallback,
                  pop: false,
                  next: null,
                  push: null,
                  error: false,
                  fallback: false,
                  value: null,
                  type: null,
                  shouldThrow: false
                };
                for (var key in obj) {
                  if (hasOwnProperty.call(obj, key)) {
                    options[key] = obj[key];
                  }
                }
                if (typeof options.type === "string" && type !== options.type) {
                  throw new Error("Type transform cannot be a string (type '" + options.type + "' for token '" + type + "')");
                }
                var match = options.match;
                options.match = Array.isArray(match) ? match : match ? [match] : [];
                options.match.sort(function(a, b) {
                  return isRegExp(a) && isRegExp(b) ? 0 : isRegExp(b) ? -1 : isRegExp(a) ? 1 : b.length - a.length;
                });
                return options;
              }
              function toRules(spec) {
                return Array.isArray(spec) ? arrayToRules(spec) : objectToRules(spec);
              }
              var defaultErrorRule = ruleOptions("error", { lineBreaks: true, shouldThrow: true });
              function compileRules(rules, hasStates) {
                var errorRule = null;
                var fast = /* @__PURE__ */ Object.create(null);
                var fastAllowed = true;
                var unicodeFlag = null;
                var groups = [];
                var parts = [];
                for (var i = 0; i < rules.length; i++) {
                  if (rules[i].fallback) {
                    fastAllowed = false;
                  }
                }
                for (var i = 0; i < rules.length; i++) {
                  var options = rules[i];
                  if (options.include) {
                    throw new Error("Inheritance is not allowed in stateless lexers");
                  }
                  if (options.error || options.fallback) {
                    if (errorRule) {
                      if (!options.fallback === !errorRule.fallback) {
                        throw new Error("Multiple " + (options.fallback ? "fallback" : "error") + " rules not allowed (for token '" + options.defaultType + "')");
                      } else {
                        throw new Error("fallback and error are mutually exclusive (for token '" + options.defaultType + "')");
                      }
                    }
                    errorRule = options;
                  }
                  var match = options.match.slice();
                  if (fastAllowed) {
                    while (match.length && typeof match[0] === "string" && match[0].length === 1) {
                      var word = match.shift();
                      fast[word.charCodeAt(0)] = options;
                    }
                  }
                  if (options.pop || options.push || options.next) {
                    if (!hasStates) {
                      throw new Error("State-switching options are not allowed in stateless lexers (for token '" + options.defaultType + "')");
                    }
                    if (options.fallback) {
                      throw new Error("State-switching options are not allowed on fallback tokens (for token '" + options.defaultType + "')");
                    }
                  }
                  if (match.length === 0) {
                    continue;
                  }
                  fastAllowed = false;
                  groups.push(options);
                  for (var j = 0; j < match.length; j++) {
                    var obj = match[j];
                    if (!isRegExp(obj)) {
                      continue;
                    }
                    if (unicodeFlag === null) {
                      unicodeFlag = obj.unicode;
                    } else if (unicodeFlag !== obj.unicode && options.fallback === false) {
                      throw new Error("If one rule is /u then all must be");
                    }
                  }
                  var pat = reUnion(match.map(regexpOrLiteral));
                  var regexp = new RegExp(pat);
                  if (regexp.test("")) {
                    throw new Error("RegExp matches empty string: " + regexp);
                  }
                  var groupCount = reGroups(pat);
                  if (groupCount > 0) {
                    throw new Error("RegExp has capture groups: " + regexp + "\nUse (?: \u2026 ) instead");
                  }
                  if (!options.lineBreaks && regexp.test("\n")) {
                    throw new Error("Rule should declare lineBreaks: " + regexp);
                  }
                  parts.push(reCapture(pat));
                }
                var fallbackRule = errorRule && errorRule.fallback;
                var flags = hasSticky && !fallbackRule ? "ym" : "gm";
                var suffix = hasSticky || fallbackRule ? "" : "|";
                if (unicodeFlag === true) flags += "u";
                var combined = new RegExp(reUnion(parts) + suffix, flags);
                return { regexp: combined, groups, fast, error: errorRule || defaultErrorRule };
              }
              function compile(rules) {
                var result = compileRules(toRules(rules));
                return new Lexer({ start: result }, "start");
              }
              function checkStateGroup(g, name, map) {
                var state = g && (g.push || g.next);
                if (state && !map[state]) {
                  throw new Error("Missing state '" + state + "' (in token '" + g.defaultType + "' of state '" + name + "')");
                }
                if (g && g.pop && +g.pop !== 1) {
                  throw new Error("pop must be 1 (in token '" + g.defaultType + "' of state '" + name + "')");
                }
              }
              function compileStates(states, start) {
                var all = states.$all ? toRules(states.$all) : [];
                delete states.$all;
                var keys = Object.getOwnPropertyNames(states);
                if (!start) start = keys[0];
                var ruleMap = /* @__PURE__ */ Object.create(null);
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  ruleMap[key] = toRules(states[key]).concat(all);
                }
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  var rules = ruleMap[key];
                  var included = /* @__PURE__ */ Object.create(null);
                  for (var j = 0; j < rules.length; j++) {
                    var rule = rules[j];
                    if (!rule.include) continue;
                    var splice = [j, 1];
                    if (rule.include !== key && !included[rule.include]) {
                      included[rule.include] = true;
                      var newRules = ruleMap[rule.include];
                      if (!newRules) {
                        throw new Error("Cannot include nonexistent state '" + rule.include + "' (in state '" + key + "')");
                      }
                      for (var k = 0; k < newRules.length; k++) {
                        var newRule = newRules[k];
                        if (rules.indexOf(newRule) !== -1) continue;
                        splice.push(newRule);
                      }
                    }
                    rules.splice.apply(rules, splice);
                    j--;
                  }
                }
                var map = /* @__PURE__ */ Object.create(null);
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  map[key] = compileRules(ruleMap[key], true);
                }
                for (var i = 0; i < keys.length; i++) {
                  var name = keys[i];
                  var state = map[name];
                  var groups = state.groups;
                  for (var j = 0; j < groups.length; j++) {
                    checkStateGroup(groups[j], name, map);
                  }
                  var fastKeys = Object.getOwnPropertyNames(state.fast);
                  for (var j = 0; j < fastKeys.length; j++) {
                    checkStateGroup(state.fast[fastKeys[j]], name, map);
                  }
                }
                return new Lexer(map, start);
              }
              function keywordTransform(map) {
                var isMap = typeof Map !== "undefined";
                var reverseMap = isMap ? /* @__PURE__ */ new Map() : /* @__PURE__ */ Object.create(null);
                var types2 = Object.getOwnPropertyNames(map);
                for (var i = 0; i < types2.length; i++) {
                  var tokenType = types2[i];
                  var item = map[tokenType];
                  var keywordList = Array.isArray(item) ? item : [item];
                  keywordList.forEach(function(keyword) {
                    if (typeof keyword !== "string") {
                      throw new Error("keyword must be string (in keyword '" + tokenType + "')");
                    }
                    if (isMap) {
                      reverseMap.set(keyword, tokenType);
                    } else {
                      reverseMap[keyword] = tokenType;
                    }
                  });
                }
                return function(k) {
                  return isMap ? reverseMap.get(k) : reverseMap[k];
                };
              }
              var Lexer = function(states, state) {
                this.startState = state;
                this.states = states;
                this.buffer = "";
                this.stack = [];
                this.reset();
              };
              Lexer.prototype.reset = function(data, info) {
                this.buffer = data || "";
                this.index = 0;
                this.line = info ? info.line : 1;
                this.col = info ? info.col : 1;
                this.queuedToken = info ? info.queuedToken : null;
                this.queuedText = info ? info.queuedText : "";
                this.queuedThrow = info ? info.queuedThrow : null;
                this.setState(info ? info.state : this.startState);
                this.stack = info && info.stack ? info.stack.slice() : [];
                return this;
              };
              Lexer.prototype.save = function() {
                return {
                  line: this.line,
                  col: this.col,
                  state: this.state,
                  stack: this.stack.slice(),
                  queuedToken: this.queuedToken,
                  queuedText: this.queuedText,
                  queuedThrow: this.queuedThrow
                };
              };
              Lexer.prototype.setState = function(state) {
                if (!state || this.state === state) return;
                this.state = state;
                var info = this.states[state];
                this.groups = info.groups;
                this.error = info.error;
                this.re = info.regexp;
                this.fast = info.fast;
              };
              Lexer.prototype.popState = function() {
                this.setState(this.stack.pop());
              };
              Lexer.prototype.pushState = function(state) {
                this.stack.push(this.state);
                this.setState(state);
              };
              var eat = hasSticky ? function(re, buffer) {
                return re.exec(buffer);
              } : function(re, buffer) {
                var match = re.exec(buffer);
                if (match[0].length === 0) {
                  return null;
                }
                return match;
              };
              Lexer.prototype._getGroup = function(match) {
                var groupCount = this.groups.length;
                for (var i = 0; i < groupCount; i++) {
                  if (match[i + 1] !== void 0) {
                    return this.groups[i];
                  }
                }
                throw new Error("Cannot find token type for matched text");
              };
              function tokenToString() {
                return this.value;
              }
              Lexer.prototype.next = function() {
                var index = this.index;
                if (this.queuedGroup) {
                  var token = this._token(this.queuedGroup, this.queuedText, index);
                  this.queuedGroup = null;
                  this.queuedText = "";
                  return token;
                }
                var buffer = this.buffer;
                if (index === buffer.length) {
                  return;
                }
                var group = this.fast[buffer.charCodeAt(index)];
                if (group) {
                  return this._token(group, buffer.charAt(index), index);
                }
                var re = this.re;
                re.lastIndex = index;
                var match = eat(re, buffer);
                var error = this.error;
                if (match == null) {
                  return this._token(error, buffer.slice(index, buffer.length), index);
                }
                var group = this._getGroup(match);
                var text = match[0];
                if (error.fallback && match.index !== index) {
                  this.queuedGroup = group;
                  this.queuedText = text;
                  return this._token(error, buffer.slice(index, match.index), index);
                }
                return this._token(group, text, index);
              };
              Lexer.prototype._token = function(group, text, offset) {
                var lineBreaks = 0;
                if (group.lineBreaks) {
                  var matchNL = /\n/g;
                  var nl = 1;
                  if (text === "\n") {
                    lineBreaks = 1;
                  } else {
                    while (matchNL.exec(text)) {
                      lineBreaks++;
                      nl = matchNL.lastIndex;
                    }
                  }
                }
                var token = {
                  type: typeof group.type === "function" && group.type(text) || group.defaultType,
                  value: typeof group.value === "function" ? group.value(text) : text,
                  text,
                  toString: tokenToString,
                  offset,
                  lineBreaks,
                  line: this.line,
                  col: this.col
                };
                var size = text.length;
                this.index += size;
                this.line += lineBreaks;
                if (lineBreaks !== 0) {
                  this.col = size - nl + 1;
                } else {
                  this.col += size;
                }
                if (group.shouldThrow) {
                  var err2 = new Error(this.formatError(token, "invalid syntax"));
                  throw err2;
                }
                if (group.pop) this.popState();
                else if (group.push) this.pushState(group.push);
                else if (group.next) this.setState(group.next);
                return token;
              };
              if (typeof Symbol !== "undefined" && Symbol.iterator) {
                var LexerIterator = function(lexer) {
                  this.lexer = lexer;
                };
                LexerIterator.prototype.next = function() {
                  var token = this.lexer.next();
                  return { value: token, done: !token };
                };
                LexerIterator.prototype[Symbol.iterator] = function() {
                  return this;
                };
                Lexer.prototype[Symbol.iterator] = function() {
                  return new LexerIterator(this);
                };
              }
              Lexer.prototype.formatError = function(token, message) {
                if (token == null) {
                  var text = this.buffer.slice(this.index);
                  var token = {
                    text,
                    offset: this.index,
                    lineBreaks: text.indexOf("\n") === -1 ? 0 : 1,
                    line: this.line,
                    col: this.col
                  };
                }
                var numLinesAround = 2;
                var firstDisplayedLine = Math.max(token.line - numLinesAround, 1);
                var lastDisplayedLine = token.line + numLinesAround;
                var lastLineDigits = String(lastDisplayedLine).length;
                var displayedLines = lastNLines(
                  this.buffer,
                  this.line - token.line + numLinesAround + 1
                ).slice(0, 5);
                var errorLines = [];
                errorLines.push(message + " at line " + token.line + " col " + token.col + ":");
                errorLines.push("");
                for (var i = 0; i < displayedLines.length; i++) {
                  var line = displayedLines[i];
                  var lineNo = firstDisplayedLine + i;
                  errorLines.push(pad(String(lineNo), lastLineDigits) + "  " + line);
                  if (lineNo === token.line) {
                    errorLines.push(pad("", lastLineDigits + token.col + 1) + "^");
                  }
                }
                return errorLines.join("\n");
              };
              Lexer.prototype.clone = function() {
                return new Lexer(this.states, this.state);
              };
              Lexer.prototype.has = function(tokenType) {
                return true;
              };
              return {
                compile,
                states: compileStates,
                error: Object.freeze({ error: true }),
                fallback: Object.freeze({ fallback: true }),
                keywords: keywordTransform
              };
            });
          })
        ),
        /***/
        812: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.stringify = stringify;
            function stringify(msgDefs) {
              let output = "";
              for (let i = 0; i < msgDefs.length; i++) {
                const msgDef = msgDefs[i];
                const constants = msgDef.definitions.filter(({ isConstant }) => isConstant);
                const variables = msgDef.definitions.filter(({ isConstant }) => isConstant == void 0 || !isConstant);
                if (i > 0) {
                  output += "\n================================================================================\n";
                  output += `MSG: ${msgDef.name ?? ""}
`;
                }
                for (const def of constants) {
                  output += `${def.type} ${def.name} = ${def.valueText ?? String(def.value)}
`;
                }
                if (variables.length > 0) {
                  if (output.length > 0) {
                    output += "\n";
                  }
                  for (const def of variables) {
                    const upperBound = def.upperBound != void 0 ? `<=${def.upperBound}` : "";
                    const arrayLength = def.arrayLength != void 0 ? String(def.arrayLength) : def.arrayUpperBound != void 0 ? `<=${def.arrayUpperBound}` : "";
                    const array = def.isArray === true ? `[${arrayLength}]` : "";
                    const defaultValue = def.defaultValue != void 0 ? ` ${stringifyDefaultValue(def.defaultValue)}` : "";
                    output += `${def.type}${upperBound}${array} ${def.name}${defaultValue}
`;
                  }
                }
              }
              return output.trimEnd();
            }
            function stringifyDefaultValue(value) {
              if (Array.isArray(value)) {
                return `[${value.map((x) => typeof x === "bigint" ? x.toString() : JSON.stringify(x)).join(", ")}]`;
              }
              return typeof value === "bigint" ? value.toString() : JSON.stringify(value);
            }
          })
        ),
        /***/
        881: (
          /***/
          (function(__unused_webpack_module, exports3, __webpack_require__2) {
            "use strict";
            var __createBinding = this && this.__createBinding || (Object.create ? (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              var desc = Object.getOwnPropertyDescriptor(m, k);
              if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
                desc = { enumerable: true, get: function() {
                  return m[k];
                } };
              }
              Object.defineProperty(o, k2, desc);
            }) : (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              o[k2] = m[k];
            }));
            var __exportStar = this && this.__exportStar || function(m, exports4) {
              for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports4, p)) __createBinding(exports4, m, p);
            };
            Object.defineProperty(exports3, "__esModule", { value: true });
            __exportStar(__webpack_require__2(425), exports3);
            __exportStar(__webpack_require__2(954), exports3);
            __exportStar(__webpack_require__2(812), exports3);
          })
        ),
        /***/
        900: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.isMsgDefFieldEqual = isMsgDefFieldEqual;
            exports3.isMsgDefEqual = isMsgDefEqual;
            function defaultValuesEqual(lhs, rhs) {
              if (Array.isArray(lhs) && Array.isArray(rhs)) {
                if (lhs.length !== rhs.length) {
                  return false;
                }
                for (let i = 0; i < lhs.length; i++) {
                  if (lhs[i] !== rhs[i]) {
                    return false;
                  }
                }
                return true;
              }
              return lhs === rhs;
            }
            function isMsgDefFieldEqual(lhs, rhs) {
              return lhs.type === rhs.type && lhs.name === rhs.name && (lhs.isComplex ?? false) === (rhs.isComplex ?? false) && lhs.enumType === rhs.enumType && (lhs.isArray ?? false) === (rhs.isArray ?? false) && lhs.arrayLength === rhs.arrayLength && (lhs.isConstant ?? false) === (rhs.isConstant ?? false) && lhs.value === rhs.value && lhs.valueText === rhs.valueText && lhs.upperBound === rhs.upperBound && lhs.arrayUpperBound === rhs.arrayUpperBound && (lhs.deprecated ?? false) === (rhs.deprecated ?? false) && defaultValuesEqual(lhs.defaultValue, rhs.defaultValue);
            }
            function isMsgDefEqual(lhs, rhs) {
              return (lhs.name == void 0 || rhs.name == void 0 || lhs.name === rhs.name) && lhs.definitions.length === rhs.definitions.length && lhs.definitions.every((def, i) => isMsgDefFieldEqual(def, rhs.definitions[i]));
            }
          })
        ),
        /***/
        954: (
          /***/
          (function(__unused_webpack_module, exports3, __webpack_require__2) {
            "use strict";
            var __importDefault = this && this.__importDefault || function(mod) {
              return mod && mod.__esModule ? mod : { "default": mod };
            };
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.parse = parse;
            exports3.fixupTypes = fixupTypes;
            exports3.normalizeType = normalizeType2;
            const message_definition_1 = __webpack_require__2(155);
            const nearley_1 = __webpack_require__2(662);
            const buildRos2Type_1 = __webpack_require__2(91);
            const ros1_ne_1 = __importDefault(__webpack_require__2(666));
            const ROS1_GRAMMAR = nearley_1.Grammar.fromCompiled(ros1_ne_1.default);
            function parse(messageDefinition, options = {}) {
              const allLines = messageDefinition.split("\n").map((line) => line.trim()).filter((line) => line);
              let definitionLines = [];
              const types2 = [];
              allLines.forEach((line) => {
                if (line.startsWith("#")) {
                  return;
                }
                if (line.startsWith("==")) {
                  types2.push(options.ros2 === true ? (0, buildRos2Type_1.buildRos2Type)(definitionLines) : buildType(definitionLines, ROS1_GRAMMAR));
                  definitionLines = [];
                } else {
                  definitionLines.push({ line });
                }
              });
              types2.push(options.ros2 === true ? (0, buildRos2Type_1.buildRos2Type)(definitionLines) : buildType(definitionLines, ROS1_GRAMMAR));
              const seenTypes = [];
              const uniqueTypes = types2.filter((definition) => {
                return seenTypes.find((otherDefinition) => (0, message_definition_1.isMsgDefEqual)(definition, otherDefinition)) ? false : seenTypes.push(definition);
              });
              if (options.skipTypeFixup !== true) {
                fixupTypes(uniqueTypes);
              }
              return uniqueTypes;
            }
            function fixupTypes(types2) {
              types2.forEach(({ definitions, name }) => {
                definitions.forEach((definition) => {
                  if (definition.isComplex === true) {
                    const typeNamespace = name?.split("/").slice(0, -1).join("/");
                    const foundName = findTypeByName2(types2, definition.type, typeNamespace).name;
                    if (foundName == void 0) {
                      throw new Error(`Missing type definition for ${definition.type}`);
                    }
                    definition.type = foundName;
                  }
                });
              });
            }
            function buildType(lines, grammar) {
              const definitions = [];
              let complexTypeName;
              lines.forEach(({ line }) => {
                if (line.startsWith("MSG:")) {
                  const [_, name] = simpleTokenization(line);
                  complexTypeName = name?.trim();
                  return;
                }
                const parser = new nearley_1.Parser(grammar);
                parser.feed(line);
                const results = parser.finish();
                if (results.length === 0) {
                  throw new Error(`Could not parse line: '${line}'`);
                } else if (results.length > 1) {
                  throw new Error(`Ambiguous line: '${line}'`);
                }
                const result = results[0];
                if (result != void 0) {
                  result.type = normalizeType2(result.type);
                  definitions.push(result);
                }
              });
              return { name: complexTypeName, definitions };
            }
            function simpleTokenization(line) {
              return line.replace(/#.*/gi, "").split(" ").filter((word) => word);
            }
            function findTypeByName2(types2, name, typeNamespace) {
              const matches = types2.filter((type) => {
                const typeName = type.name ?? "";
                if (name.length === 0) {
                  return typeName.length === 0;
                }
                if (name.includes("/")) {
                  return typeName === name;
                } else if (name === "Header") {
                  return typeName === `std_msgs/Header`;
                } else if (typeNamespace) {
                  return typeName === `${typeNamespace}/${name}`;
                } else {
                  return typeName.endsWith(`/${name}`);
                }
              });
              if (matches[0] == void 0) {
                throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}`);
              }
              if (matches.length > 1) {
                throw new Error(`Cannot unambiguously determine fully-qualified type name for '${name}'`);
              }
              return matches[0];
            }
            function normalizeType2(type) {
              if (type === "char") {
                return "uint8";
              } else if (type === "byte") {
                return "int8";
              }
              return type;
            }
          })
        )
        /******/
      };
      var __webpack_module_cache__ = {};
      function __webpack_require__(moduleId) {
        var cachedModule = __webpack_module_cache__[moduleId];
        if (cachedModule !== void 0) {
          return cachedModule.exports;
        }
        var module3 = __webpack_module_cache__[moduleId] = {
          /******/
          // no module.id needed
          /******/
          // no module.loaded needed
          /******/
          exports: {}
          /******/
        };
        __webpack_modules__[moduleId].call(module3.exports, module3, module3.exports, __webpack_require__);
        return module3.exports;
      }
      (() => {
        __webpack_require__.d = (exports3, definition) => {
          for (var key in definition) {
            if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports3, key)) {
              Object.defineProperty(exports3, key, { enumerable: true, get: definition[key] });
            }
          }
        };
      })();
      (() => {
        __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
      })();
      (() => {
        __webpack_require__.r = (exports3) => {
          if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
            Object.defineProperty(exports3, Symbol.toStringTag, { value: "Module" });
          }
          Object.defineProperty(exports3, "__esModule", { value: true });
        };
      })();
      var __webpack_exports__ = __webpack_require__(881);
      module2.exports = __webpack_exports__;
    })();
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/EncapsulationKind.js
var require_EncapsulationKind = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/EncapsulationKind.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.EncapsulationKind = void 0;
    var EncapsulationKind;
    (function(EncapsulationKind2) {
      EncapsulationKind2[EncapsulationKind2["CDR_BE"] = 0] = "CDR_BE";
      EncapsulationKind2[EncapsulationKind2["CDR_LE"] = 1] = "CDR_LE";
      EncapsulationKind2[EncapsulationKind2["PL_CDR_BE"] = 2] = "PL_CDR_BE";
      EncapsulationKind2[EncapsulationKind2["PL_CDR_LE"] = 3] = "PL_CDR_LE";
      EncapsulationKind2[EncapsulationKind2["CDR2_BE"] = 16] = "CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["CDR2_LE"] = 17] = "CDR2_LE";
      EncapsulationKind2[EncapsulationKind2["PL_CDR2_BE"] = 18] = "PL_CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["PL_CDR2_LE"] = 19] = "PL_CDR2_LE";
      EncapsulationKind2[EncapsulationKind2["DELIMITED_CDR2_BE"] = 20] = "DELIMITED_CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["DELIMITED_CDR2_LE"] = 21] = "DELIMITED_CDR2_LE";
      EncapsulationKind2[EncapsulationKind2["RTPS_CDR2_BE"] = 6] = "RTPS_CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["RTPS_CDR2_LE"] = 7] = "RTPS_CDR2_LE";
      EncapsulationKind2[EncapsulationKind2["RTPS_DELIMITED_CDR2_BE"] = 8] = "RTPS_DELIMITED_CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["RTPS_DELIMITED_CDR2_LE"] = 9] = "RTPS_DELIMITED_CDR2_LE";
      EncapsulationKind2[EncapsulationKind2["RTPS_PL_CDR2_BE"] = 10] = "RTPS_PL_CDR2_BE";
      EncapsulationKind2[EncapsulationKind2["RTPS_PL_CDR2_LE"] = 11] = "RTPS_PL_CDR2_LE";
    })(EncapsulationKind = exports2.EncapsulationKind || (exports2.EncapsulationKind = {}));
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/getEncapsulationKindInfo.js
var require_getEncapsulationKindInfo = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/getEncapsulationKindInfo.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getEncapsulationKindInfo = void 0;
    var EncapsulationKind_1 = require_EncapsulationKind();
    var getEncapsulationKindInfo = (kind) => {
      const isCDR2 = kind > EncapsulationKind_1.EncapsulationKind.PL_CDR_LE;
      const littleEndian = kind === EncapsulationKind_1.EncapsulationKind.CDR_LE || kind === EncapsulationKind_1.EncapsulationKind.PL_CDR_LE || kind === EncapsulationKind_1.EncapsulationKind.CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.PL_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.DELIMITED_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_PL_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_DELIMITED_CDR2_LE;
      const isDelimitedCDR2 = kind === EncapsulationKind_1.EncapsulationKind.DELIMITED_CDR2_BE || kind === EncapsulationKind_1.EncapsulationKind.DELIMITED_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_DELIMITED_CDR2_BE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_DELIMITED_CDR2_LE;
      const isPLCDR2 = kind === EncapsulationKind_1.EncapsulationKind.PL_CDR2_BE || kind === EncapsulationKind_1.EncapsulationKind.PL_CDR2_LE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_PL_CDR2_BE || kind === EncapsulationKind_1.EncapsulationKind.RTPS_PL_CDR2_LE;
      const isPLCDR1 = kind === EncapsulationKind_1.EncapsulationKind.PL_CDR_BE || kind === EncapsulationKind_1.EncapsulationKind.PL_CDR_LE;
      const usesDelimiterHeader = isDelimitedCDR2 || isPLCDR2;
      const usesMemberHeader = isPLCDR2 || isPLCDR1;
      return {
        isCDR2,
        littleEndian,
        usesDelimiterHeader,
        usesMemberHeader
      };
    };
    exports2.getEncapsulationKindInfo = getEncapsulationKindInfo;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/isBigEndian.js
var require_isBigEndian = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/isBigEndian.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isBigEndian = void 0;
    var endianTestArray = new Uint8Array(4);
    var endianTestView = new Uint32Array(endianTestArray.buffer);
    endianTestView[0] = 1;
    function isBigEndian() {
      return endianTestArray[3] === 1;
    }
    exports2.isBigEndian = isBigEndian;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/lengthCodes.js
var require_lengthCodes = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/lengthCodes.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.lengthCodeToObjectSizes = exports2.getLengthCodeForObjectSize = void 0;
    function getLengthCodeForObjectSize(objectSize) {
      let defaultLengthCode;
      switch (objectSize) {
        case 1:
          defaultLengthCode = 0;
          break;
        case 2:
          defaultLengthCode = 1;
          break;
        case 4:
          defaultLengthCode = 2;
          break;
        case 8:
          defaultLengthCode = 3;
          break;
      }
      if (defaultLengthCode == void 0) {
        if (objectSize > 4294967295) {
          throw Error(`Object size ${objectSize} for EMHEADER too large without specifying length code. Max size is ${4294967295}`);
        }
        defaultLengthCode = 4;
      }
      return defaultLengthCode;
    }
    exports2.getLengthCodeForObjectSize = getLengthCodeForObjectSize;
    exports2.lengthCodeToObjectSizes = {
      0: 1,
      1: 2,
      2: 4,
      3: 8
    };
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/reservedPIDs.js
var require_reservedPIDs = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/reservedPIDs.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.SENTINEL_PID = exports2.EXTENDED_PID = void 0;
    exports2.EXTENDED_PID = 16129;
    exports2.SENTINEL_PID = 16130;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrReader.js
var require_CdrReader = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrReader.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CdrReader = void 0;
    var getEncapsulationKindInfo_1 = require_getEncapsulationKindInfo();
    var isBigEndian_1 = require_isBigEndian();
    var lengthCodes_1 = require_lengthCodes();
    var reservedPIDs_1 = require_reservedPIDs();
    var textDecoder2 = new TextDecoder("utf8");
    var CdrReader = class _CdrReader {
      constructor(data) {
        this.origin = 0;
        if (data.byteLength < 4) {
          throw new Error(`Invalid CDR data size ${data.byteLength}, must contain at least a 4-byte header`);
        }
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const kind = this.kind;
        const { isCDR2, littleEndian, usesDelimiterHeader, usesMemberHeader } = (0, getEncapsulationKindInfo_1.getEncapsulationKindInfo)(kind);
        this.usesDelimiterHeader = usesDelimiterHeader;
        this.usesMemberHeader = usesMemberHeader;
        this.littleEndian = littleEndian;
        this.hostLittleEndian = !(0, isBigEndian_1.isBigEndian)();
        this.isCDR2 = isCDR2;
        this.eightByteAlignment = isCDR2 ? 4 : 8;
        this.origin = 4;
        this.offset = 4;
      }
      get kind() {
        return this.view.getUint8(1);
      }
      get decodedBytes() {
        return this.offset;
      }
      get byteLength() {
        return this.view.byteLength;
      }
      int8() {
        const value = this.view.getInt8(this.offset);
        this.offset += 1;
        return value;
      }
      uint8() {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
      }
      int16() {
        this.align(2);
        const value = this.view.getInt16(this.offset, this.littleEndian);
        this.offset += 2;
        return value;
      }
      uint16() {
        this.align(2);
        const value = this.view.getUint16(this.offset, this.littleEndian);
        this.offset += 2;
        return value;
      }
      int32() {
        this.align(4);
        const value = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
      }
      uint32() {
        this.align(4);
        const value = this.view.getUint32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
      }
      int64() {
        this.align(this.eightByteAlignment);
        const value = this.view.getBigInt64(this.offset, this.littleEndian);
        this.offset += 8;
        return value;
      }
      uint64() {
        this.align(this.eightByteAlignment);
        const value = this.view.getBigUint64(this.offset, this.littleEndian);
        this.offset += 8;
        return value;
      }
      uint16BE() {
        this.align(2);
        const value = this.view.getUint16(this.offset, false);
        this.offset += 2;
        return value;
      }
      uint32BE() {
        this.align(4);
        const value = this.view.getUint32(this.offset, false);
        this.offset += 4;
        return value;
      }
      uint64BE() {
        this.align(this.eightByteAlignment);
        const value = this.view.getBigUint64(this.offset, false);
        this.offset += 8;
        return value;
      }
      float32() {
        this.align(4);
        const value = this.view.getFloat32(this.offset, this.littleEndian);
        this.offset += 4;
        return value;
      }
      float64() {
        this.align(this.eightByteAlignment);
        const value = this.view.getFloat64(this.offset, this.littleEndian);
        this.offset += 8;
        return value;
      }
      string(prereadLength) {
        const length = prereadLength ?? this.uint32();
        if (length <= 1) {
          this.offset += length;
          return "";
        }
        const data = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length - 1);
        const value = textDecoder2.decode(data);
        this.offset += length;
        return value;
      }
      /** Reads the delimiter header which contains and returns the object size */
      dHeader() {
        const header = this.uint32();
        return header;
      }
      /**
       * Reads the member header (EMHEADER) and returns the member ID, mustUnderstand flag, and object size with optional length code
       * The length code is only present in CDR2 and should prompt objectSize to be used in place of sequence length if applicable.
       * See Extensible and Dynamic Topic Types (DDS-XTypes) v1.3 @ `7.4.3.4.2` for more info about CDR2 EMHEADER composition.
       * If a sentinelHeader was read (PL_CDR v1), the readSentinelHeader flag is set to true.
       */
      emHeader() {
        if (this.isCDR2) {
          return this.memberHeaderV2();
        } else {
          return this.memberHeaderV1();
        }
      }
      /** XCDR1 PL_CDR encapsulation parameter header*/
      memberHeaderV1() {
        this.align(4);
        const idHeader = this.uint16();
        const mustUnderstandFlag = (idHeader & 16384) >> 14 === 1;
        const implementationSpecificFlag = (idHeader & 32768) >> 15 === 1;
        const extendedPIDFlag = (idHeader & 16383) === reservedPIDs_1.EXTENDED_PID;
        const sentinelPIDFlag = (idHeader & 16383) === reservedPIDs_1.SENTINEL_PID;
        if (sentinelPIDFlag) {
          this.uint16();
          return { id: reservedPIDs_1.SENTINEL_PID, objectSize: 0, mustUnderstand: false, readSentinelHeader: true };
        }
        const usesReservedParameterId = (idHeader & 16383) > reservedPIDs_1.SENTINEL_PID;
        if (usesReservedParameterId || implementationSpecificFlag) {
          throw new Error(`Unsupported parameter ID header ${idHeader.toString(16)}`);
        }
        if (extendedPIDFlag) {
          this.uint16();
        }
        const id = extendedPIDFlag ? this.uint32() : idHeader & 16383;
        const objectSize = extendedPIDFlag ? this.uint32() : this.uint16();
        this.resetOrigin();
        return { id, objectSize, mustUnderstand: mustUnderstandFlag };
      }
      /** Sets the origin to the offset (DDS-XTypes Spec: `PUSH(ORIGIN = 0)`)*/
      resetOrigin() {
        this.origin = this.offset;
      }
      /** Reads boolean flag for optional members in CDR2
       * Will throw an error if called for CDR1.
       */
      isPresentFlag() {
        if (!this.isCDR2) {
          throw new Error("isPresentFlag is only supported for CDR2");
        }
        const isPresent = Boolean(this.uint8());
        return isPresent;
      }
      /** Reads the PID_SENTINEL value if encapsulation kind supports it (PL_CDR version 1)
       * @returns true if the sentinel header was read, false otherwise
       */
      sentinelHeader() {
        if (!this.isCDR2) {
          this.align(4);
          const header = this.uint16();
          const sentinelPIDFlag = (header & 16383) === reservedPIDs_1.SENTINEL_PID;
          if (!sentinelPIDFlag) {
            return false;
          }
          this.uint16();
          return true;
        } else {
          return false;
        }
      }
      memberHeaderV2() {
        const header = this.uint32();
        const mustUnderstand = Math.abs((header & 2147483648) >> 31) === 1;
        const lengthCode = (header & 1879048192) >> 28;
        const id = header & 268435455;
        const objectSize = this.emHeaderObjectSize(lengthCode);
        return { mustUnderstand, id, objectSize, lengthCode };
      }
      /** Uses the length code to derive the member object size in
       * the EMHEADER, sometimes reading NEXTINT (the next uint32
       * following the header) from the buffer */
      emHeaderObjectSize(lengthCode) {
        switch (lengthCode) {
          case 0:
          case 1:
          case 2:
          case 3:
            return lengthCodes_1.lengthCodeToObjectSizes[lengthCode];
          // LC > 3 -> NEXTINT exists after header
          case 4:
          case 5:
            return this.uint32();
          case 6:
            return 4 * this.uint32();
          case 7:
            return 8 * this.uint32();
          default:
            throw new Error(
              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
              `Invalid length code ${lengthCode} in EMHEADER at offset ${this.offset - 4}`
            );
        }
      }
      sequenceLength() {
        return this.uint32();
      }
      int8Array(count = this.sequenceLength()) {
        const array = new Int8Array(this.view.buffer, this.view.byteOffset + this.offset, count);
        this.offset += count;
        return array;
      }
      uint8Array(count = this.sequenceLength()) {
        const array = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, count);
        this.offset += count;
        return array;
      }
      int16Array(count = this.sequenceLength()) {
        return this.typedArray(Int16Array, "getInt16", count);
      }
      uint16Array(count = this.sequenceLength()) {
        return this.typedArray(Uint16Array, "getUint16", count);
      }
      int32Array(count = this.sequenceLength()) {
        return this.typedArray(Int32Array, "getInt32", count);
      }
      uint32Array(count = this.sequenceLength()) {
        return this.typedArray(Uint32Array, "getUint32", count);
      }
      int64Array(count = this.sequenceLength()) {
        return this.typedArray(BigInt64Array, "getBigInt64", count, this.eightByteAlignment);
      }
      uint64Array(count = this.sequenceLength()) {
        return this.typedArray(BigUint64Array, "getBigUint64", count, this.eightByteAlignment);
      }
      float32Array(count = this.sequenceLength()) {
        return this.typedArray(Float32Array, "getFloat32", count);
      }
      float64Array(count = this.sequenceLength()) {
        return this.typedArray(Float64Array, "getFloat64", count, this.eightByteAlignment);
      }
      stringArray(count = this.sequenceLength()) {
        const output = [];
        for (let i = 0; i < count; i++) {
          output.push(this.string());
        }
        return output;
      }
      /**
       * Seek the current read pointer a number of bytes relative to the current position. Note that
       * seeking before the four-byte header is invalid
       * @param relativeOffset A positive or negative number of bytes to seek
       */
      seek(relativeOffset) {
        const newOffset = this.offset + relativeOffset;
        if (newOffset < 4 || newOffset > this.view.byteLength) {
          throw new Error(`seek(${relativeOffset}) failed, ${newOffset} is outside the data range`);
        }
        this.offset = newOffset;
      }
      /**
       * Seek to an absolute byte position in the data. Note that seeking before the four-byte header is
       * invalid
       * @param offset An absolute byte offset in the range of [4-byteLength)
       */
      seekTo(offset) {
        if (offset < 4 || offset > this.view.byteLength) {
          throw new Error(`seekTo(${offset}) failed, value is outside the data range`);
        }
        this.offset = offset;
      }
      /**
       * Duplicate this reader. The underlying buffer is reused and not copied.
       */
      clone() {
        const clone = new _CdrReader(this.view);
        clone.offset = this.offset;
        clone.origin = this.origin;
        return clone;
      }
      /**
       * Limit the reader to a given number of bytes.
       * @param length The number of bytes to limit the reader to.
       */
      limit(length) {
        const newByteLength = this.offset + length;
        if (newByteLength <= this.view.byteLength) {
          this.view = new DataView(this.view.buffer, this.view.byteOffset, newByteLength);
        } else {
          throw new RangeError(`length ${length} exceeds byte length of view`);
        }
      }
      /**
       * Returns `true` if the reader is at the end of the buffer, or `false` otherwise.
       */
      isAtEnd() {
        return this.offset >= this.view.byteLength;
      }
      align(size) {
        const alignment = (this.offset - this.origin) % size;
        if (alignment > 0) {
          this.offset += size - alignment;
        }
      }
      // Reads a given count of numeric values into a typed array.
      typedArray(TypedArrayConstructor, getter, count, alignment = TypedArrayConstructor.BYTES_PER_ELEMENT) {
        if (count === 0) {
          return new TypedArrayConstructor();
        }
        this.align(alignment);
        const totalOffset = this.view.byteOffset + this.offset;
        if (this.littleEndian !== this.hostLittleEndian) {
          return this.typedArraySlow(TypedArrayConstructor, getter, count);
        } else if (totalOffset % TypedArrayConstructor.BYTES_PER_ELEMENT === 0) {
          const array = new TypedArrayConstructor(this.view.buffer, totalOffset, count);
          this.offset += TypedArrayConstructor.BYTES_PER_ELEMENT * count;
          return array;
        } else {
          return this.typedArrayUnaligned(TypedArrayConstructor, getter, count);
        }
      }
      typedArrayUnaligned(TypedArrayConstructor, getter, count) {
        if (count < 10) {
          return this.typedArraySlow(TypedArrayConstructor, getter, count);
        }
        const byteLength = TypedArrayConstructor.BYTES_PER_ELEMENT * count;
        const copy = new Uint8Array(byteLength);
        copy.set(new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, byteLength));
        this.offset += byteLength;
        return new TypedArrayConstructor(copy.buffer, copy.byteOffset, count);
      }
      typedArraySlow(TypedArrayConstructor, getter, count) {
        const array = new TypedArrayConstructor(count);
        let offset = this.offset;
        for (let i = 0; i < count; i++) {
          array[i] = this.view[getter](offset, this.littleEndian);
          offset += TypedArrayConstructor.BYTES_PER_ELEMENT;
        }
        this.offset = offset;
        return array;
      }
    };
    exports2.CdrReader = CdrReader;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrSizeCalculator.js
var require_CdrSizeCalculator = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrSizeCalculator.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CdrSizeCalculator = void 0;
    var CdrSizeCalculator = class {
      constructor() {
        this.offset = 4;
      }
      get size() {
        return this.offset;
      }
      int8() {
        return this.incrementAndReturn(1);
      }
      uint8() {
        return this.incrementAndReturn(1);
      }
      int16() {
        return this.incrementAndReturn(2);
      }
      uint16() {
        return this.incrementAndReturn(2);
      }
      int32() {
        return this.incrementAndReturn(4);
      }
      uint32() {
        return this.incrementAndReturn(4);
      }
      int64() {
        return this.incrementAndReturn(8);
      }
      uint64() {
        return this.incrementAndReturn(8);
      }
      float32() {
        return this.incrementAndReturn(4);
      }
      float64() {
        return this.incrementAndReturn(8);
      }
      string(length) {
        this.uint32();
        this.offset += length + 1;
        return this.offset;
      }
      sequenceLength() {
        return this.uint32();
      }
      // Increments the offset by `byteCount` and any required padding bytes and
      // returns the new offset
      incrementAndReturn(byteCount) {
        const alignment = (this.offset - 4) % byteCount;
        if (alignment > 0) {
          this.offset += byteCount - alignment;
        }
        this.offset += byteCount;
        return this.offset;
      }
    };
    exports2.CdrSizeCalculator = CdrSizeCalculator;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrWriter.js
var require_CdrWriter = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/CdrWriter.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CdrWriter = void 0;
    var EncapsulationKind_1 = require_EncapsulationKind();
    var getEncapsulationKindInfo_1 = require_getEncapsulationKindInfo();
    var isBigEndian_1 = require_isBigEndian();
    var lengthCodes_1 = require_lengthCodes();
    var reservedPIDs_1 = require_reservedPIDs();
    var textEncoder = new TextEncoder();
    var CdrWriter = class _CdrWriter {
      constructor(options = {}) {
        if (options.buffer != void 0) {
          this.buffer = options.buffer;
        } else if (options.size != void 0) {
          this.buffer = new ArrayBuffer(options.size);
        } else {
          this.buffer = new ArrayBuffer(_CdrWriter.DEFAULT_CAPACITY);
        }
        const kind = options.kind ?? EncapsulationKind_1.EncapsulationKind.CDR_LE;
        const { isCDR2, littleEndian } = (0, getEncapsulationKindInfo_1.getEncapsulationKindInfo)(kind);
        this.isCDR2 = isCDR2;
        this.littleEndian = littleEndian;
        this.hostLittleEndian = !(0, isBigEndian_1.isBigEndian)();
        this.eightByteAlignment = isCDR2 ? 4 : 8;
        this.array = new Uint8Array(this.buffer);
        this.view = new DataView(this.buffer);
        this.resizeIfNeeded(4);
        this.view.setUint8(0, 0);
        this.view.setUint8(1, kind);
        this.view.setUint16(2, 0, false);
        this.offset = 4;
        this.origin = 4;
      }
      get data() {
        return new Uint8Array(this.buffer, 0, this.offset);
      }
      get size() {
        return this.offset;
      }
      get kind() {
        return this.view.getUint8(1);
      }
      int8(value) {
        this.resizeIfNeeded(1);
        this.view.setInt8(this.offset, value);
        this.offset += 1;
        return this;
      }
      uint8(value) {
        this.resizeIfNeeded(1);
        this.view.setUint8(this.offset, value);
        this.offset += 1;
        return this;
      }
      int16(value) {
        this.align(2);
        this.view.setInt16(this.offset, value, this.littleEndian);
        this.offset += 2;
        return this;
      }
      uint16(value) {
        this.align(2);
        this.view.setUint16(this.offset, value, this.littleEndian);
        this.offset += 2;
        return this;
      }
      int32(value) {
        this.align(4);
        this.view.setInt32(this.offset, value, this.littleEndian);
        this.offset += 4;
        return this;
      }
      uint32(value) {
        this.align(4);
        this.view.setUint32(this.offset, value, this.littleEndian);
        this.offset += 4;
        return this;
      }
      int64(value) {
        this.align(this.eightByteAlignment, 8);
        this.view.setBigInt64(this.offset, value, this.littleEndian);
        this.offset += 8;
        return this;
      }
      uint64(value) {
        this.align(this.eightByteAlignment, 8);
        this.view.setBigUint64(this.offset, value, this.littleEndian);
        this.offset += 8;
        return this;
      }
      uint16BE(value) {
        this.align(2);
        this.view.setUint16(this.offset, value, false);
        this.offset += 2;
        return this;
      }
      uint32BE(value) {
        this.align(4);
        this.view.setUint32(this.offset, value, false);
        this.offset += 4;
        return this;
      }
      uint64BE(value) {
        this.align(this.eightByteAlignment, 8);
        this.view.setBigUint64(this.offset, value, false);
        this.offset += 8;
        return this;
      }
      float32(value) {
        this.align(4);
        this.view.setFloat32(this.offset, value, this.littleEndian);
        this.offset += 4;
        return this;
      }
      float64(value) {
        this.align(this.eightByteAlignment, 8);
        this.view.setFloat64(this.offset, value, this.littleEndian);
        this.offset += 8;
        return this;
      }
      // writeLength optional because it could already be included in a header
      string(value, writeLength = true) {
        const strlen = value.length;
        if (writeLength) {
          this.uint32(strlen + 1);
        }
        this.resizeIfNeeded(strlen + 1);
        textEncoder.encodeInto(value, new Uint8Array(this.buffer, this.offset, strlen));
        this.view.setUint8(this.offset + strlen, 0);
        this.offset += strlen + 1;
        return this;
      }
      /** Writes the delimiter header using object size
       * NOTE: changing endian-ness with a single CDR message is not supported
       */
      dHeader(objectSize) {
        const header = objectSize;
        this.uint32(header);
        return this;
      }
      /**
       * Writes the member header (EMHEADER)
       * Accomodates for PL_CDR and PL_CDR2 based on the CdrWriter constructor options
       *
       * @param mustUnderstand - Whether the member is required to be understood by the receiver
       * @param id - The member ID
       * @param objectSize - The size of the member in bytes
       * @param lengthCode - Optional length code for CDR2 emHeaders.
       * lengthCode values [5-7] allow the emHeader object size to take the place of the normally encoded member length.
       *
       * NOTE: Dynamically determines default value if not provided that does not affect serialization ie will use lengthCode values [0-4].
       *
       * From Extensible and Dynamic Topic Types in DDS-XTypes v1.3 @ `7.4.3.4.2`:
       * "EMHEADER1 with LC values 5 to 7 also affect the serialization/deserialization virtual machine in that they cause NEXTINT to be
       * reused also as part of the serialized member. This is useful because the serialization of certain members also starts with an
       * integer length, which would take exactly the same value as NEXTINT. Therefore the use of length codes 5 to 7 saves 4 bytes in
       * the serialization."
       * @returns - CdrWriter instance
       */
      emHeader(mustUnderstand, id, objectSize, lengthCode) {
        return this.isCDR2 ? this.memberHeaderV2(mustUnderstand, id, objectSize, lengthCode) : this.memberHeaderV1(mustUnderstand, id, objectSize);
      }
      memberHeaderV1(mustUnderstand, id, objectSize) {
        this.align(4);
        const mustUnderstandFlag = mustUnderstand ? 1 << 14 : 0;
        const shouldUseExtendedPID = id > 16128 || objectSize > 65535;
        if (!shouldUseExtendedPID) {
          const idHeader = mustUnderstandFlag | id;
          this.uint16(idHeader);
          const objectSizeHeader = objectSize & 65535;
          this.uint16(objectSizeHeader);
        } else {
          const extendedHeader = mustUnderstandFlag | reservedPIDs_1.EXTENDED_PID;
          this.uint16(extendedHeader);
          this.uint16(8);
          this.uint32(id);
          this.uint32(objectSize);
        }
        this.resetOrigin();
        return this;
      }
      /** Sets the origin to the offset (DDS-XTypes Spec: `PUSH(ORIGIN = 0)`)*/
      resetOrigin() {
        this.origin = this.offset;
      }
      /** Writes boolean flag for optional members in CDR2
       * @throws Error if called for CDR1.
       */
      presentFlag(value) {
        if (!this.isCDR2) {
          throw new Error("presentFlag is only supported for CDR2");
        }
        this.uint8(value ? 1 : 0);
        return this;
      }
      /** Writes the PID_SENTINEL value if encapsulation supports it*/
      sentinelHeader() {
        if (!this.isCDR2) {
          this.align(4);
          this.uint16(reservedPIDs_1.SENTINEL_PID);
          this.uint16(0);
        }
        return this;
      }
      memberHeaderV2(mustUnderstand, id, objectSize, lengthCode) {
        if (id > 268435455) {
          throw Error(`Member ID ${id} is too large. Max value is ${268435455}`);
        }
        const mustUnderstandFlag = mustUnderstand ? 1 << 31 : 0;
        const finalLengthCode = lengthCode ?? (0, lengthCodes_1.getLengthCodeForObjectSize)(objectSize);
        const header = mustUnderstandFlag | finalLengthCode << 28 | id;
        this.uint32(header);
        switch (finalLengthCode) {
          case 0:
          case 1:
          case 2:
          case 3: {
            const shouldBeSize = lengthCodes_1.lengthCodeToObjectSizes[finalLengthCode];
            if (objectSize !== shouldBeSize) {
              throw new Error(`Cannot write a length code ${finalLengthCode} header with an object size not equal to ${shouldBeSize}`);
            }
            break;
          }
          // When the length code is > 3 the header is 8 bytes because of the NEXTINT value storing the object size
          case 4:
          case 5:
            this.uint32(objectSize);
            break;
          case 6:
            if (objectSize % 4 !== 0) {
              throw new Error("Cannot write a length code 6 header with an object size that is not a multiple of 4");
            }
            this.uint32(objectSize >> 2);
            break;
          case 7:
            if (objectSize % 8 !== 0) {
              throw new Error("Cannot write a length code 7 header with an object size that is not a multiple of 8");
            }
            this.uint32(objectSize >> 3);
            break;
          default:
            throw new Error(`Unexpected length code ${finalLengthCode}`);
        }
        return this;
      }
      sequenceLength(value) {
        return this.uint32(value);
      }
      int8Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        this.resizeIfNeeded(value.length);
        this.array.set(value, this.offset);
        this.offset += value.length;
        return this;
      }
      uint8Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        this.resizeIfNeeded(value.length);
        this.array.set(value, this.offset);
        this.offset += value.length;
        return this;
      }
      int16Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Int16Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.int16(entry);
          }
        }
        return this;
      }
      uint16Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Uint16Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.uint16(entry);
          }
        }
        return this;
      }
      int32Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Int32Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.int32(entry);
          }
        }
        return this;
      }
      uint32Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Uint32Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.uint32(entry);
          }
        }
        return this;
      }
      int64Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof BigInt64Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.int64(BigInt(entry));
          }
        }
        return this;
      }
      uint64Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof BigUint64Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.uint64(BigInt(entry));
          }
        }
        return this;
      }
      float32Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Float32Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.float32(entry);
          }
        }
        return this;
      }
      float64Array(value, writeLength) {
        if (writeLength === true) {
          this.sequenceLength(value.length);
        }
        if (value instanceof Float64Array && this.littleEndian === this.hostLittleEndian && value.length >= _CdrWriter.BUFFER_COPY_THRESHOLD) {
          this.align(value.BYTES_PER_ELEMENT, value.byteLength);
          this.array.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.offset);
          this.offset += value.byteLength;
        } else {
          for (const entry of value) {
            this.float64(entry);
          }
        }
        return this;
      }
      /**
       * Calculate the capacity needed to hold the given number of aligned bytes,
       * resize if needed, and write padding bytes for alignment
       * @param size Byte width to align to. If the current offset is 1 and `size`
       *   is 4, 3 bytes of padding will be written
       * @param bytesToWrite Optional, total amount of bytes that are intended to be
       *   written directly following the alignment. This can be used to avoid
       *   additional buffer resizes in the case of writing large blocks of aligned
       *   data such as arrays
       */
      align(size, bytesToWrite = size) {
        const alignment = (this.offset - this.origin) % size;
        const padding = alignment > 0 ? size - alignment : 0;
        this.resizeIfNeeded(padding + bytesToWrite);
        this.array.fill(0, this.offset, this.offset + padding);
        this.offset += padding;
      }
      resizeIfNeeded(additionalBytes) {
        const capacity = this.offset + additionalBytes;
        if (this.buffer.byteLength < capacity) {
          const doubled = this.buffer.byteLength * 2;
          const newCapacity = doubled > capacity ? doubled : capacity;
          this.resize(newCapacity);
        }
      }
      resize(capacity) {
        if (this.buffer.byteLength >= capacity) {
          return;
        }
        const buffer = new ArrayBuffer(capacity);
        const array = new Uint8Array(buffer);
        array.set(this.array);
        this.buffer = buffer;
        this.array = array;
        this.view = new DataView(buffer);
      }
    };
    exports2.CdrWriter = CdrWriter;
    CdrWriter.DEFAULT_CAPACITY = 16;
    CdrWriter.BUFFER_COPY_THRESHOLD = 10;
  }
});

// node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/.pnpm/@foxglove+cdr@3.5.0/node_modules/@foxglove/cdr/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_CdrReader(), exports2);
    __exportStar(require_CdrSizeCalculator(), exports2);
    __exportStar(require_CdrWriter(), exports2);
    __exportStar(require_EncapsulationKind(), exports2);
  }
});

// node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/messageDefinitionHasDataFields.js
var require_messageDefinitionHasDataFields = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/messageDefinitionHasDataFields.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.messageDefinitionHasDataFields = messageDefinitionHasDataFields;
    function messageDefinitionHasDataFields(fields) {
      return fields.some((field) => field.isConstant !== true);
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/MessageReader.js
var require_MessageReader = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/MessageReader.js"(exports2) {
    "use strict";
    var __classPrivateFieldGet = exports2 && exports2.__classPrivateFieldGet || function(receiver, state, kind, f2) {
      if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
    };
    var __classPrivateFieldSet = exports2 && exports2.__classPrivateFieldSet || function(receiver, state, value, kind, f2) {
      if (kind === "m") throw new TypeError("Private method is not writable");
      if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a setter");
      if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
      return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
    };
    var _MessageReader_instances;
    var _MessageReader_rootDefinition;
    var _MessageReader_definitions;
    var _MessageReader_lastReadByteLength;
    var _MessageReader_lastReadHadTrailingBytes;
    var _MessageReader_useRos1Time;
    var _MessageReader_readComplexType;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MessageReader = void 0;
    var cdr_1 = require_dist2();
    var messageDefinitionHasDataFields_1 = require_messageDefinitionHasDataFields();
    var MessageReader3 = class {
      /**
       * True when the most recent decode finished before reaching the end of the buffer, excluding CDR
       * final padding. CDR ignores trailing bytes by design, so this can signal a schema/payload
       * version mismatch.
       */
      lastReadHadTrailingBytes() {
        return __classPrivateFieldGet(this, _MessageReader_lastReadHadTrailingBytes, "f");
      }
      /**
       * Number of bytes consumed by the most recent decode.
       */
      lastReadByteLength() {
        return __classPrivateFieldGet(this, _MessageReader_lastReadByteLength, "f");
      }
      constructor(definitions, options = {}) {
        _MessageReader_instances.add(this);
        _MessageReader_rootDefinition.set(this, void 0);
        _MessageReader_definitions.set(this, void 0);
        _MessageReader_lastReadByteLength.set(this, 0);
        _MessageReader_lastReadHadTrailingBytes.set(this, false);
        _MessageReader_useRos1Time.set(this, void 0);
        const { timeType = "sec,nanosec" } = options;
        const rootDefinition = definitions.find((def) => !isConstantModule(def));
        if (rootDefinition == void 0) {
          throw new Error("MessageReader initialized with no root MessageDefinition");
        }
        __classPrivateFieldSet(this, _MessageReader_rootDefinition, rootDefinition.definitions, "f");
        __classPrivateFieldSet(this, _MessageReader_definitions, new Map(definitions.map((def) => [def.name ?? "", def.definitions])), "f");
        __classPrivateFieldSet(this, _MessageReader_useRos1Time, timeType === "sec,nsec", "f");
      }
      // We template on R here for call site type information if the class type information T is not
      // known or available
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
      readMessage(buffer) {
        const reader = new cdr_1.CdrReader(buffer);
        const value = __classPrivateFieldGet(this, _MessageReader_instances, "m", _MessageReader_readComplexType).call(this, __classPrivateFieldGet(this, _MessageReader_rootDefinition, "f"), reader);
        __classPrivateFieldSet(this, _MessageReader_lastReadByteLength, reader.decodedBytes, "f");
        __classPrivateFieldSet(this, _MessageReader_lastReadHadTrailingBytes, __classPrivateFieldGet(this, _MessageReader_lastReadByteLength, "f") < buffer.byteLength && !isCdrFinalPadding(buffer, __classPrivateFieldGet(this, _MessageReader_lastReadByteLength, "f")), "f");
        return value;
      }
    };
    exports2.MessageReader = MessageReader3;
    _MessageReader_rootDefinition = /* @__PURE__ */ new WeakMap(), _MessageReader_definitions = /* @__PURE__ */ new WeakMap(), _MessageReader_lastReadByteLength = /* @__PURE__ */ new WeakMap(), _MessageReader_lastReadHadTrailingBytes = /* @__PURE__ */ new WeakMap(), _MessageReader_useRos1Time = /* @__PURE__ */ new WeakMap(), _MessageReader_instances = /* @__PURE__ */ new WeakSet(), _MessageReader_readComplexType = function _MessageReader_readComplexType2(definition, reader) {
      const msg = {};
      if (!(0, messageDefinitionHasDataFields_1.messageDefinitionHasDataFields)(definition)) {
        reader.uint8();
        return msg;
      }
      for (const field of definition) {
        if (field.isConstant === true) {
          continue;
        }
        if (field.isComplex === true) {
          const nestedDefinition = __classPrivateFieldGet(this, _MessageReader_definitions, "f").get(field.type);
          if (nestedDefinition == void 0) {
            throw new Error(`Unrecognized complex type ${field.type}`);
          }
          if (field.isArray === true) {
            const arrayLength = field.arrayLength ?? reader.sequenceLength();
            const array = [];
            for (let i = 0; i < arrayLength; i++) {
              array.push(__classPrivateFieldGet(this, _MessageReader_instances, "m", _MessageReader_readComplexType2).call(this, nestedDefinition, reader));
            }
            msg[field.name] = array;
          } else {
            msg[field.name] = __classPrivateFieldGet(this, _MessageReader_instances, "m", _MessageReader_readComplexType2).call(this, nestedDefinition, reader);
          }
        } else {
          if (field.isArray === true) {
            const deser = (__classPrivateFieldGet(this, _MessageReader_useRos1Time, "f") ? ros1TypedArrayDeserializers : typedArrayDeserializers).get(field.type);
            if (deser == void 0) {
              throw new Error(`Unrecognized primitive array type ${field.type}[]`);
            }
            const arrayLength = field.arrayLength ?? reader.sequenceLength();
            msg[field.name] = deser(reader, arrayLength);
          } else {
            const deser = (__classPrivateFieldGet(this, _MessageReader_useRos1Time, "f") ? ros1TimeDeserializers : deserializers).get(field.type);
            if (deser == void 0) {
              throw new Error(`Unrecognized primitive type ${field.type}`);
            }
            msg[field.name] = deser(reader);
          }
        }
      }
      return msg;
    };
    function isConstantModule(def) {
      return def.definitions.length > 0 && def.definitions.every((field) => field.isConstant);
    }
    function isCdrFinalPadding(buffer, decodedBytes) {
      const trailingByteLength = buffer.byteLength - decodedBytes;
      if (trailingByteLength <= 0) {
        return false;
      }
      const paddingToFourByteBoundary = (4 - decodedBytes % 4) % 4;
      const paddingToEightByteBoundary = (8 - decodedBytes % 8) % 8;
      if (trailingByteLength !== paddingToFourByteBoundary && trailingByteLength !== paddingToEightByteBoundary) {
        return false;
      }
      const trailingBytes = new Uint8Array(buffer.buffer, buffer.byteOffset + decodedBytes, trailingByteLength);
      return trailingBytes.every((byte) => byte === 0);
    }
    var deserializers = /* @__PURE__ */ new Map([
      ["bool", (reader) => Boolean(reader.int8())],
      ["int8", (reader) => reader.int8()],
      ["uint8", (reader) => reader.uint8()],
      ["int16", (reader) => reader.int16()],
      ["uint16", (reader) => reader.uint16()],
      ["int32", (reader) => reader.int32()],
      ["uint32", (reader) => reader.uint32()],
      ["int64", (reader) => reader.int64()],
      ["uint64", (reader) => reader.uint64()],
      ["float32", (reader) => reader.float32()],
      ["float64", (reader) => reader.float64()],
      ["string", (reader) => reader.string()],
      ["wstring", throwOnWstring],
      ["time", (reader) => ({ sec: reader.int32(), nanosec: reader.uint32() })],
      ["duration", (reader) => ({ sec: reader.int32(), nanosec: reader.uint32() })]
    ]);
    var ros1TimeDeserializers = new Map([
      ...deserializers,
      ["time", (reader) => ({ sec: reader.int32(), nsec: reader.uint32() })],
      ["duration", (reader) => ({ sec: reader.int32(), nsec: reader.uint32() })]
    ]);
    var typedArrayDeserializers = /* @__PURE__ */ new Map([
      ["bool", readBoolArray],
      ["int8", (reader, count) => reader.int8Array(count)],
      ["uint8", (reader, count) => reader.uint8Array(count)],
      ["int16", (reader, count) => reader.int16Array(count)],
      ["uint16", (reader, count) => reader.uint16Array(count)],
      ["int32", (reader, count) => reader.int32Array(count)],
      ["uint32", (reader, count) => reader.uint32Array(count)],
      ["int64", (reader, count) => reader.int64Array(count)],
      ["uint64", (reader, count) => reader.uint64Array(count)],
      ["float32", (reader, count) => reader.float32Array(count)],
      ["float64", (reader, count) => reader.float64Array(count)],
      ["string", readStringArray],
      ["wstring", throwOnWstring],
      ["time", readTimeArray],
      ["duration", readTimeArray]
    ]);
    var ros1TypedArrayDeserializers = new Map([
      ...typedArrayDeserializers,
      ["time", readRos1TimeArray],
      ["duration", readRos1TimeArray]
    ]);
    function readBoolArray(reader, count) {
      const array = new Array(count);
      for (let i = 0; i < count; i++) {
        array[i] = Boolean(reader.int8());
      }
      return array;
    }
    function readStringArray(reader, count) {
      const array = new Array(count);
      for (let i = 0; i < count; i++) {
        array[i] = reader.string();
      }
      return array;
    }
    function readRos1TimeArray(reader, count) {
      const array = new Array(count);
      for (let i = 0; i < count; i++) {
        const sec = reader.int32();
        const nsec = reader.uint32();
        array[i] = { sec, nsec };
      }
      return array;
    }
    function readTimeArray(reader, count) {
      const array = new Array(count);
      for (let i = 0; i < count; i++) {
        const sec = reader.int32();
        const nanosec = reader.uint32();
        array[i] = { sec, nanosec };
      }
      return array;
    }
    function throwOnWstring() {
      throw new Error("wstring is implementation-defined and therefore not supported");
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/MessageWriter.js
var require_MessageWriter = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/MessageWriter.js"(exports2) {
    "use strict";
    var __classPrivateFieldSet = exports2 && exports2.__classPrivateFieldSet || function(receiver, state, value, kind, f2) {
      if (kind === "m") throw new TypeError("Private method is not writable");
      if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a setter");
      if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
      return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
    };
    var __classPrivateFieldGet = exports2 && exports2.__classPrivateFieldGet || function(receiver, state, kind, f2) {
      if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
    };
    var _MessageWriter_instances;
    var _MessageWriter_rootDefinition;
    var _MessageWriter_definitions;
    var _MessageWriter_byteSize;
    var _MessageWriter_write;
    var _MessageWriter_getDefinition;
    var _MessageWriter_getPrimitiveSize;
    var _MessageWriter_getPrimitiveWriter;
    var _MessageWriter_getPrimitiveArrayWriter;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MessageWriter = void 0;
    var cdr_1 = require_dist2();
    var messageDefinitionHasDataFields_1 = require_messageDefinitionHasDataFields();
    var PRIMITIVE_SIZES = /* @__PURE__ */ new Map([
      ["bool", 1],
      ["int8", 1],
      ["uint8", 1],
      ["int16", 2],
      ["uint16", 2],
      ["int32", 4],
      ["uint32", 4],
      ["int64", 8],
      ["uint64", 8],
      ["float32", 4],
      ["float64", 8],
      // ["string", ...], // handled separately
      ["time", 8],
      ["duration", 8]
    ]);
    var PRIMITIVE_WRITERS = /* @__PURE__ */ new Map([
      ["bool", bool],
      ["int8", int8],
      ["uint8", uint8],
      ["int16", int16],
      ["uint16", uint16],
      ["int32", int32],
      ["uint32", uint32],
      ["int64", int64],
      ["uint64", uint64],
      ["float32", float32],
      ["float64", float64],
      ["string", string],
      ["time", time],
      ["duration", time],
      ["wstring", throwOnWstring]
    ]);
    var PRIMITIVE_ARRAY_WRITERS = /* @__PURE__ */ new Map([
      ["bool", boolArray],
      ["int8", int8Array],
      ["uint8", uint8Array],
      ["int16", int16Array],
      ["uint16", uint16Array],
      ["int32", int32Array],
      ["uint32", uint32Array],
      ["int64", int64Array],
      ["uint64", uint64Array],
      ["float32", float32Array],
      ["float64", float64Array],
      ["string", stringArray],
      ["time", timeArray],
      ["duration", timeArray],
      ["wstring", throwOnWstring]
    ]);
    function throwOnWstring() {
      throw new Error("wstring is implementation-defined and therefore not supported");
    }
    var MessageWriter2 = class {
      constructor(definitions) {
        _MessageWriter_instances.add(this);
        _MessageWriter_rootDefinition.set(this, void 0);
        _MessageWriter_definitions.set(this, void 0);
        const rootDefinition = definitions.find((def) => !isConstantModule(def));
        if (rootDefinition == void 0) {
          throw new Error("MessageReader initialized with no root MessageDefinition");
        }
        __classPrivateFieldSet(this, _MessageWriter_rootDefinition, rootDefinition.definitions, "f");
        __classPrivateFieldSet(this, _MessageWriter_definitions, new Map(definitions.map((def) => [def.name ?? "", def.definitions])), "f");
      }
      /** Calculates the byte size needed to write this message in bytes. */
      calculateByteSize(message) {
        return __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_byteSize).call(this, __classPrivateFieldGet(this, _MessageWriter_rootDefinition, "f"), message, 4);
      }
      /**
       * Serializes a JavaScript object to CDR-encoded binary according to this
       * writer's message definition. If output is provided, it's byte length must
       * be equal or greater to the result of `calculateByteSize(message)`. If not
       * provided, a new Uint8Array will be allocated.
       */
      writeMessage(message, output) {
        const writer = new cdr_1.CdrWriter({
          buffer: output,
          size: output ? void 0 : this.calculateByteSize(message)
        });
        __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_write).call(this, __classPrivateFieldGet(this, _MessageWriter_rootDefinition, "f"), message, writer);
        return writer.data;
      }
    };
    exports2.MessageWriter = MessageWriter2;
    _MessageWriter_rootDefinition = /* @__PURE__ */ new WeakMap(), _MessageWriter_definitions = /* @__PURE__ */ new WeakMap(), _MessageWriter_instances = /* @__PURE__ */ new WeakSet(), _MessageWriter_byteSize = function _MessageWriter_byteSize2(definition, message, offset) {
      const messageObj = message;
      let newOffset = offset;
      if (!(0, messageDefinitionHasDataFields_1.messageDefinitionHasDataFields)(definition)) {
        return offset + __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getPrimitiveSize).call(this, "uint8");
      }
      for (const field of definition) {
        if (field.isConstant === true) {
          continue;
        }
        const nestedMessage = messageObj?.[field.name];
        if (field.isArray === true) {
          const arrayLength = field.arrayLength ?? fieldLength(nestedMessage);
          const dataIsArray = Array.isArray(nestedMessage) || ArrayBuffer.isView(nestedMessage);
          const dataArray = dataIsArray ? nestedMessage : [];
          if (field.arrayLength == void 0) {
            newOffset += padding(newOffset, 4);
            newOffset += 4;
          }
          if (field.isComplex === true) {
            const nestedDefinition = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getDefinition).call(this, field.type);
            for (let i = 0; i < arrayLength; i++) {
              const entry = dataArray[i] ?? {};
              newOffset = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_byteSize2).call(this, nestedDefinition, entry, newOffset);
            }
          } else if (field.type === "string") {
            for (let i = 0; i < arrayLength; i++) {
              const entry = dataArray[i] ?? "";
              newOffset += padding(newOffset, 4);
              newOffset += 4 + entry.length + 1;
            }
          } else {
            const entrySize = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getPrimitiveSize).call(this, field.type);
            const alignment = field.type === "time" || field.type === "duration" ? 4 : entrySize;
            newOffset += padding(newOffset, alignment);
            newOffset += entrySize * arrayLength;
          }
        } else {
          if (field.isComplex === true) {
            const nestedDefinition = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getDefinition).call(this, field.type);
            const entry = nestedMessage ?? {};
            newOffset = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_byteSize2).call(this, nestedDefinition, entry, newOffset);
          } else if (field.type === "string") {
            const entry = typeof nestedMessage === "string" ? nestedMessage : "";
            newOffset += padding(newOffset, 4);
            newOffset += 4 + entry.length + 1;
          } else {
            const entrySize = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getPrimitiveSize).call(this, field.type);
            const alignment = field.type === "time" || field.type === "duration" ? 4 : entrySize;
            newOffset += padding(newOffset, alignment);
            newOffset += entrySize;
          }
        }
      }
      return newOffset;
    }, _MessageWriter_write = function _MessageWriter_write2(definition, message, writer) {
      const messageObj = message;
      if (!(0, messageDefinitionHasDataFields_1.messageDefinitionHasDataFields)(definition)) {
        uint8(0, 0, writer);
        return;
      }
      for (const field of definition) {
        if (field.isConstant === true) {
          continue;
        }
        const nestedMessage = messageObj?.[field.name];
        if (field.isArray === true) {
          const arrayLength = field.arrayLength ?? fieldLength(nestedMessage);
          const dataIsArray = Array.isArray(nestedMessage) || ArrayBuffer.isView(nestedMessage);
          const dataArray = dataIsArray ? nestedMessage : [];
          if (field.arrayLength == void 0) {
            writer.sequenceLength(arrayLength);
          }
          if (field.arrayLength != void 0 && nestedMessage != void 0) {
            const givenFieldLength = fieldLength(nestedMessage);
            if (givenFieldLength !== field.arrayLength) {
              throw new Error(`Expected ${field.arrayLength} items for fixed-length array field ${field.name} but received ${givenFieldLength}`);
            }
          }
          if (field.isComplex === true) {
            const nestedDefinition = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getDefinition).call(this, field.type);
            for (let i = 0; i < arrayLength; i++) {
              const entry = dataArray[i] ?? {};
              __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_write2).call(this, nestedDefinition, entry, writer);
            }
          } else {
            const arrayWriter = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getPrimitiveArrayWriter).call(this, field.type);
            arrayWriter(nestedMessage, field.defaultValue, writer, field.arrayLength);
          }
        } else {
          if (field.isComplex === true) {
            const nestedDefinition = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getDefinition).call(this, field.type);
            const entry = nestedMessage ?? {};
            __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_write2).call(this, nestedDefinition, entry, writer);
          } else {
            const primitiveWriter = __classPrivateFieldGet(this, _MessageWriter_instances, "m", _MessageWriter_getPrimitiveWriter).call(this, field.type);
            primitiveWriter(nestedMessage, field.defaultValue, writer);
          }
        }
      }
    }, _MessageWriter_getDefinition = function _MessageWriter_getDefinition2(datatype) {
      const nestedDefinition = __classPrivateFieldGet(this, _MessageWriter_definitions, "f").get(datatype);
      if (nestedDefinition == void 0) {
        throw new Error(`Unrecognized complex type ${datatype}`);
      }
      return nestedDefinition;
    }, _MessageWriter_getPrimitiveSize = function _MessageWriter_getPrimitiveSize2(primitiveType) {
      const size = PRIMITIVE_SIZES.get(primitiveType);
      if (size == void 0) {
        if (primitiveType === "wstring") {
          throwOnWstring();
        }
        throw new Error(`Unrecognized primitive type ${primitiveType}`);
      }
      return size;
    }, _MessageWriter_getPrimitiveWriter = function _MessageWriter_getPrimitiveWriter2(primitiveType) {
      const writer = PRIMITIVE_WRITERS.get(primitiveType);
      if (writer == void 0) {
        throw new Error(`Unrecognized primitive type ${primitiveType}`);
      }
      return writer;
    }, _MessageWriter_getPrimitiveArrayWriter = function _MessageWriter_getPrimitiveArrayWriter2(primitiveType) {
      const writer = PRIMITIVE_ARRAY_WRITERS.get(primitiveType);
      if (writer == void 0) {
        throw new Error(`Unrecognized primitive type ${primitiveType}[]`);
      }
      return writer;
    };
    function isConstantModule(def) {
      return def.definitions.length > 0 && def.definitions.every((field) => field.isConstant);
    }
    function fieldLength(value) {
      const length = value?.length;
      return typeof length === "number" ? length : 0;
    }
    function bool(value, defaultValue, writer) {
      const boolValue = typeof value === "boolean" ? value : defaultValue ?? false;
      writer.int8(boolValue ? 1 : 0);
    }
    function int8(value, defaultValue, writer) {
      writer.int8(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function uint8(value, defaultValue, writer) {
      writer.uint8(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function int16(value, defaultValue, writer) {
      writer.int16(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function uint16(value, defaultValue, writer) {
      writer.uint16(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function int32(value, defaultValue, writer) {
      writer.int32(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function uint32(value, defaultValue, writer) {
      writer.uint32(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function int64(value, defaultValue, writer) {
      if (typeof value === "bigint") {
        writer.int64(value);
      } else if (typeof value === "number") {
        writer.int64(BigInt(value));
      } else {
        writer.int64(defaultValue ?? 0n);
      }
    }
    function uint64(value, defaultValue, writer) {
      if (typeof value === "bigint") {
        writer.uint64(value);
      } else if (typeof value === "number") {
        writer.uint64(BigInt(value));
      } else {
        writer.uint64(defaultValue ?? 0n);
      }
    }
    function float32(value, defaultValue, writer) {
      writer.float32(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function float64(value, defaultValue, writer) {
      writer.float64(typeof value === "number" ? value : defaultValue ?? 0);
    }
    function string(value, defaultValue, writer) {
      writer.string(typeof value === "string" ? value : defaultValue ?? "");
    }
    function time(value, _defaultValue, writer) {
      if (value == void 0) {
        writer.int32(0);
        writer.uint32(0);
        return;
      }
      const timeObj = value;
      writer.int32(timeObj.sec ?? 0);
      writer.uint32(timeObj.nsec ?? timeObj.nanosec ?? 0);
    }
    function boolArray(value, defaultValue, writer, arrayLength) {
      if (Array.isArray(value)) {
        const array = new Int8Array(value);
        writer.int8Array(array);
      } else {
        writer.int8Array(defaultValue ?? new Int8Array(arrayLength ?? 0).fill(0));
      }
    }
    function int8Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Int8Array) {
        writer.int8Array(value);
      } else if (Array.isArray(value)) {
        const array = new Int8Array(value);
        writer.int8Array(array);
      } else {
        writer.int8Array(defaultValue ?? new Int8Array(arrayLength ?? 0).fill(0));
      }
    }
    function uint8Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Uint8Array) {
        writer.uint8Array(value);
      } else if (value instanceof Uint8ClampedArray) {
        writer.uint8Array(new Uint8Array(value));
      } else if (Array.isArray(value)) {
        const array = new Uint8Array(value);
        writer.uint8Array(array);
      } else {
        writer.uint8Array(defaultValue ?? new Uint8Array(arrayLength ?? 0).fill(0));
      }
    }
    function int16Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Int16Array) {
        writer.int16Array(value);
      } else if (Array.isArray(value)) {
        const array = new Int16Array(value);
        writer.int16Array(array);
      } else {
        writer.int16Array(defaultValue ?? new Int16Array(arrayLength ?? 0).fill(0));
      }
    }
    function uint16Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Uint16Array) {
        writer.uint16Array(value);
      } else if (Array.isArray(value)) {
        const array = new Uint16Array(value);
        writer.uint16Array(array);
      } else {
        writer.uint16Array(defaultValue ?? new Uint16Array(arrayLength ?? 0).fill(0));
      }
    }
    function int32Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Int32Array) {
        writer.int32Array(value);
      } else if (Array.isArray(value)) {
        const array = new Int32Array(value);
        writer.int32Array(array);
      } else {
        writer.int32Array(defaultValue ?? new Int32Array(arrayLength ?? 0).fill(0));
      }
    }
    function uint32Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Uint32Array) {
        writer.uint32Array(value);
      } else if (Array.isArray(value)) {
        const array = new Uint32Array(value);
        writer.uint32Array(array);
      } else {
        writer.uint32Array(defaultValue ?? new Uint32Array(arrayLength ?? 0).fill(0));
      }
    }
    function int64Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof BigInt64Array) {
        writer.int64Array(value);
      } else if (Array.isArray(value)) {
        const array = new BigInt64Array(value);
        writer.int64Array(array);
      } else {
        writer.int64Array(defaultValue ?? new BigInt64Array(arrayLength ?? 0).fill(0n));
      }
    }
    function uint64Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof BigUint64Array) {
        writer.uint64Array(value);
      } else if (Array.isArray(value)) {
        const array = new BigUint64Array(value);
        writer.uint64Array(array);
      } else {
        writer.uint64Array(defaultValue ?? new BigUint64Array(arrayLength ?? 0).fill(0n));
      }
    }
    function float32Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Float32Array) {
        writer.float32Array(value);
      } else if (Array.isArray(value)) {
        const array = new Float32Array(value);
        writer.float32Array(array);
      } else {
        writer.float32Array(defaultValue ?? new Float32Array(arrayLength ?? 0).fill(0));
      }
    }
    function float64Array(value, defaultValue, writer, arrayLength) {
      if (value instanceof Float64Array) {
        writer.float64Array(value);
      } else if (Array.isArray(value)) {
        const array = new Float64Array(value);
        writer.float64Array(array);
      } else {
        writer.float64Array(defaultValue ?? new Float64Array(arrayLength ?? 0).fill(0));
      }
    }
    function stringArray(value, defaultValue, writer, arrayLength) {
      if (Array.isArray(value)) {
        for (const item of value) {
          writer.string(typeof item === "string" ? item : "");
        }
      } else {
        const array = defaultValue ?? new Array(arrayLength ?? 0).fill("");
        for (const item of array) {
          writer.string(item);
        }
      }
    }
    function timeArray(value, _defaultValue, writer, arrayLength) {
      if (Array.isArray(value)) {
        for (const item of value) {
          time(item, void 0, writer);
        }
      } else {
        const array = new Array(arrayLength).fill(void 0);
        for (const item of array) {
          time(item, void 0, writer);
        }
      }
    }
    function padding(offset, byteWidth) {
      const alignment = (offset - 4) % byteWidth;
      return alignment > 0 ? byteWidth - alignment : 0;
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/index.js
var require_dist3 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg2-serialization@3.1.1/node_modules/@foxglove/rosmsg2-serialization/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_MessageReader(), exports2);
    __exportStar(require_MessageWriter(), exports2);
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/decodeString.js
var require_decodeString = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/decodeString.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = decodeString;
    var decoder = new TextDecoder();
    function decodeString(data) {
      if (data.length >= 50) {
        return decoder.decode(data);
      }
      for (let i = 0; i < data.length; i++) {
        if (data[i] & 128) {
          return decoder.decode(data);
        }
      }
      return String.fromCharCode.apply(null, data);
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/BuiltinDeserialize.js
var require_BuiltinDeserialize = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/BuiltinDeserialize.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.deserializers = exports2.fixedSizeTypes = void 0;
    var decodeString_1 = __importDefault(require_decodeString());
    function MakeTypedArrayDeserialze(TypedArrayConstructor, getter) {
      if (TypedArrayConstructor == void 0) {
        console.warn("bigint arrays are not supported in this environment");
      }
      return (view, offset, len) => {
        if (TypedArrayConstructor == void 0) {
          throw new Error("bigint arrays are not supported in this environment");
        }
        let currentOffset = offset;
        const totalOffset = view.byteOffset + currentOffset;
        const size = TypedArrayConstructor.BYTES_PER_ELEMENT * len;
        const maxSize = view.byteLength - offset;
        if (size < 0 || size > maxSize) {
          throw new RangeError(`Array(${getter}) deserialization error: size ${size}, maxSize ${maxSize}`);
        }
        if (totalOffset % TypedArrayConstructor.BYTES_PER_ELEMENT === 0) {
          return new TypedArrayConstructor(view.buffer, totalOffset, len);
        }
        if (len < 10) {
          const arr = new TypedArrayConstructor(len);
          for (let idx = 0; idx < len; ++idx) {
            arr[idx] = view[getter](currentOffset, true);
            currentOffset += TypedArrayConstructor.BYTES_PER_ELEMENT;
          }
          return arr;
        }
        const copy = new Uint8Array(size);
        copy.set(new Uint8Array(view.buffer, totalOffset, size));
        return new TypedArrayConstructor(copy.buffer, copy.byteOffset, len);
      };
    }
    exports2.fixedSizeTypes = /* @__PURE__ */ new Map([
      ["bool", 1],
      ["int8", 1],
      ["uint8", 1],
      ["int16", 2],
      ["uint16", 2],
      ["int32", 4],
      ["uint32", 4],
      ["int64", 8],
      ["uint64", 8],
      ["float32", 4],
      ["float64", 8],
      ["time", 8],
      ["duration", 8]
    ]);
    exports2.deserializers = {
      bool: (view, offset) => view.getUint8(offset) !== 0,
      int8: (view, offset) => view.getInt8(offset),
      uint8: (view, offset) => view.getUint8(offset),
      int16: (view, offset) => view.getInt16(offset, true),
      uint16: (view, offset) => view.getUint16(offset, true),
      int32: (view, offset) => view.getInt32(offset, true),
      uint32: (view, offset) => view.getUint32(offset, true),
      int64: (view, offset) => view.getBigInt64(offset, true),
      uint64: (view, offset) => view.getBigUint64(offset, true),
      float32: (view, offset) => view.getFloat32(offset, true),
      float64: (view, offset) => view.getFloat64(offset, true),
      time: (view, offset) => {
        const sec = view.getUint32(offset, true);
        const nsec = view.getUint32(offset + 4, true);
        return { sec, nsec };
      },
      duration: (view, offset) => {
        const sec = view.getInt32(offset, true);
        const nsec = view.getInt32(offset + 4, true);
        return { sec, nsec };
      },
      string: (view, offset) => {
        const len = view.getUint32(offset, true);
        const totalOffset = view.byteOffset + offset + 4;
        const maxLen = view.byteLength - offset;
        if (len < 0 || len > maxLen) {
          throw new RangeError(`String deserialization error: length ${len}, maxLength ${maxLen}`);
        }
        const data = new Uint8Array(view.buffer, totalOffset, len);
        return (0, decodeString_1.default)(data);
      },
      boolArray: (view, offset, len) => {
        let currentOffset = offset;
        const arr = new Array(len);
        for (let idx = 0; idx < len; ++idx) {
          arr[idx] = exports2.deserializers.bool(view, currentOffset);
          currentOffset += 1;
        }
        return arr;
      },
      int8Array: MakeTypedArrayDeserialze(Int8Array, "getInt8"),
      uint8Array: MakeTypedArrayDeserialze(Uint8Array, "getUint8"),
      int16Array: MakeTypedArrayDeserialze(Int16Array, "getInt16"),
      uint16Array: MakeTypedArrayDeserialze(Uint16Array, "getUint16"),
      int32Array: MakeTypedArrayDeserialze(Int32Array, "getInt32"),
      uint32Array: MakeTypedArrayDeserialze(Uint32Array, "getUint32"),
      int64Array: MakeTypedArrayDeserialze(typeof BigInt64Array === "function" ? BigInt64Array : void 0, "getBigInt64"),
      uint64Array: MakeTypedArrayDeserialze(typeof BigUint64Array === "function" ? BigUint64Array : void 0, "getBigUint64"),
      float32Array: MakeTypedArrayDeserialze(Float32Array, "getFloat32"),
      float64Array: MakeTypedArrayDeserialze(Float64Array, "getFloat64"),
      timeArray: (view, offset, len) => {
        let currentOffset = offset;
        const timeArr = new Array(len);
        const totalOffset = view.byteOffset + currentOffset;
        if (totalOffset % Int32Array.BYTES_PER_ELEMENT === 0) {
          const intArr = new Int32Array(view.buffer, totalOffset, len * 2);
          for (let i = 0, j = 0; i < len; ++i, j = j + 2) {
            timeArr[i] = {
              sec: intArr[j],
              nsec: intArr[j + 1]
            };
          }
        } else {
          for (let idx = 0; idx < len; ++idx) {
            timeArr[idx] = {
              sec: view.getInt32(currentOffset, true),
              nsec: view.getInt32(currentOffset + 4, true)
            };
            currentOffset += 8;
          }
        }
        return timeArr;
      },
      durationArray: (view, offset, len) => exports2.deserializers.timeArray(view, offset, len),
      fixedArray: (view, offset, len, elementDeser, elementSize) => {
        let currentOffset = offset;
        const arr = new Array(len);
        for (let idx = 0; idx < len; ++idx) {
          arr[idx] = elementDeser(view, currentOffset);
          currentOffset += elementSize(view, currentOffset);
        }
        return arr;
      },
      dynamicArray: (view, offset, elementDeser, elementSize) => {
        const len = view.getUint32(offset, true);
        return exports2.deserializers.fixedArray(view, offset + 4, len, elementDeser, elementSize);
      }
    };
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/buildReader.js
var require_buildReader = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/buildReader.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = buildReader;
    var _1 = require_cjs();
    var BuiltinDeserialize_1 = require_BuiltinDeserialize();
    var builtinSizes = {
      // strings are the only builtin type that are variable size
      string: (view, offset) => {
        const len = view.getUint32(offset, true);
        const maxLen = view.byteLength - offset - 4;
        if (len < 0 || len > maxLen) {
          throw new RangeError(`String length error: length ${len}, maxLength ${maxLen}`);
        }
        return 4 + len;
      },
      fixedArray: (view, startOffset, len, typeSize) => {
        let offset = startOffset;
        let size = 0;
        for (let idx = 0; idx < len; ++idx) {
          const elementSize = typeSize(view, offset);
          size += elementSize;
          offset += elementSize;
        }
        const maxSize = view.byteLength - startOffset;
        if (size > maxSize) {
          throw new RangeError(`Fixed array length error: size ${size}, maxSize ${maxSize}`);
        }
        return size;
      },
      array: (view, startOffset, typeSize) => {
        let offset = startOffset;
        const len = view.getUint32(offset, true);
        let size = 4;
        offset += 4;
        for (let idx = 0; idx < len; ++idx) {
          const elementSize = typeSize(view, offset);
          size += elementSize;
          offset += elementSize;
        }
        const maxSize = view.byteLength - startOffset;
        if (size > maxSize) {
          throw new RangeError(`Dynamic array length error: size ${size}, maxSize ${maxSize}`);
        }
        return size;
      }
    };
    function sanitizeName(name) {
      return name.replace(/^[0-9]|[^a-zA-Z0-9_]/g, "_");
    }
    function sizeFunction(field) {
      if (field.isConstant === true) {
        return "";
      }
      const fieldSize = BuiltinDeserialize_1.fixedSizeTypes.get(field.type);
      if (fieldSize == void 0) {
        const fieldSizeFn = field.type === "string" ? "builtinSizes.string" : `${sanitizeName(field.type)}.size`;
        if (field.isArray === true) {
          if (field.arrayLength != void 0) {
            return `
          static __${field.name}$size(view /* dataview */, offset) {
              return builtinSizes.fixedArray(view, offset, ${field.arrayLength}, ${fieldSizeFn});
          }`;
          } else {
            return `
          static __${field.name}$size(view /* dataview */, offset) {
              return builtinSizes.array(view, offset, ${fieldSizeFn});
          }`;
          }
        }
        return `
      static __${field.name}$size(view /* dataview */, offset) {
          return ${fieldSizeFn}(view, offset);
      }`;
      } else {
        if (field.isArray === true) {
          if (field.arrayLength != void 0) {
            return `
          static __${field.name}$size(view /* dataview */, offset) {
            return ${fieldSize} * ${field.arrayLength};
          }`;
          } else {
            return `
          static __${field.name}$size(view /* dataview */, offset) {
            const len = view.getUint32(offset, true);
            return 4 + len * ${fieldSize};
          }`;
          }
        }
        return `
      static __${field.name}$size(view /* dataview */, offset) {
          return ${fieldSize};
      }`;
      }
    }
    function sizePartForDefinition(className, field) {
      if (field.isConstant === true) {
        return "";
      }
      const fieldSize = BuiltinDeserialize_1.fixedSizeTypes.get(field.type);
      const isFixedArray = field.isArray === true && field.arrayLength != void 0;
      if (fieldSize != void 0 && (isFixedArray || field.isArray === false)) {
        if (field.arrayLength != void 0) {
          const totalSize = fieldSize * field.arrayLength;
          return `
        // ${field.type}[${field.arrayLength}] ${field.name}
        totalSize += ${totalSize};
        offset += ${totalSize};
      `;
        } else {
          return `
        // ${field.type} ${field.name}
        totalSize += ${fieldSize};
        offset += ${fieldSize};
      `;
        }
      }
      return `
    // ${field.type} ${field.name}
    {
        const size = ${className}.__${field.name}$size(view, offset);
        totalSize += size;
        offset += size;
    }
    `;
    }
    function getterFunction(field) {
      if (field.isConstant === true) {
        return "";
      }
      const isBuiltinReader = field.type in BuiltinDeserialize_1.deserializers;
      const isBuiltinSize = field.type in builtinSizes;
      const readerFn = isBuiltinReader ? `deserializers.${field.type}` : `${sanitizeName(field.type)}.build`;
      const sizeFn = isBuiltinSize ? `builtinSizes.${field.type}` : `${sanitizeName(field.type)}.size`;
      const fieldSize = BuiltinDeserialize_1.fixedSizeTypes.get(field.type);
      if (field.isArray === true) {
        const arrLen = field.arrayLength;
        if (arrLen != void 0) {
          if (fieldSize != void 0) {
            return `
          // ${field.type}[${arrLen}] ${field.name}
          get ${field.name}() {
            const offset = this.__${field.name}$offset(this.#view, this.#offset);
            return deserializers.${field.type}Array(this.#view, offset, ${arrLen});
          }`;
          } else {
            return `
        // ${field.type}[${arrLen}] ${field.name}
          get ${field.name}() {
            const offset = this.__${field.name}$offset(this.#view, this.#offset);
            return deserializers.fixedArray(this.#view, offset, ${arrLen}, ${readerFn}, ${sizeFn});
          }`;
          }
        } else {
          if (fieldSize != void 0) {
            return `
          // ${field.type}[] ${field.name}
          get ${field.name}() {
            const offset = this.__${field.name}$offset(this.#view, this.#offset);
            const len = this.#view.getUint32(offset, true);
            return deserializers.${field.type}Array(this.#view, offset + 4, len);
          }`;
          } else {
            return `
          // ${field.type}[] ${field.name}
          get ${field.name}() {
            const offset = this.__${field.name}$offset(this.#view, this.#offset);
            return deserializers.dynamicArray(this.#view, offset, ${readerFn}, ${sizeFn});
          }`;
          }
        }
      } else {
        return `get ${field.name}() {
        const offset = this.__${field.name}$offset(this.#view, this.#offset);
        return ${readerFn}(this.#view, offset);
      }`;
      }
    }
    function buildReader(definitions) {
      const classes = new Array();
      const rootClassName = "__RootMsg";
      for (const type of definitions) {
        const name = sanitizeName(type.name ?? rootClassName);
        const offsetFns = new Array();
        const initializers = new Array();
        let prevField;
        for (const field of type.definitions) {
          if (field.isConstant === true) {
            continue;
          }
          if (prevField == void 0) {
            offsetFns.push(`
          __${field.name}$offset(view, initOffset) {
            return initOffset;
          }`);
          } else {
            initializers.push(`#_${field.name}_offset_cache = undefined;`);
            offsetFns.push(`
          __${field.name}$offset(view, initOffset) {
            if (this.#_${field.name}_offset_cache) {
              return this.#_${field.name}_offset_cache;
            }
            const prevOffset = this.__${prevField.name}$offset(view, initOffset);
            const totalOffset = prevOffset + ${name}.__${prevField.name}$size(view, prevOffset);
            this.#_${field.name}_offset_cache = totalOffset;
            return totalOffset;
          }`);
          }
          prevField = field;
        }
        const messageSrc = `class ${name} {
        ${type.definitions.map(sizeFunction).join("\n")}

        // return the total serialized size of the message in the view
        static size(view /* DataView */, initOffset = 0) {
          let totalSize = 0;
          let offset = initOffset;

          ${type.definitions.map(sizePartForDefinition.bind(void 0, name)).join("\n")}

          return totalSize;
        }

        ${offsetFns.join("\n")}

        // return an instance of ${name} from the view at initOffset bytes into the view
        // NOTE: the underlying view data lifetime must be at least the lifetime of the instance
        static build(view /* DataView */, offset = 0) {
          return new ${name}(view, offset);
        }

        #view = undefined;
        #offset;
        ${initializers.join("\n")}
  
        constructor(view, offset = 0) {
          this.#view = view;
          this.#offset = offset;
        }

        // return a json object of the fields
        // This fully deserializes all fields of the message into native types
        // Typed arrays are considered native types and remain as typed arrays
        toJSON() {
          const view = this.#view;
          const buffer = new Uint8Array(view.buffer, view.byteOffset + this.#offset, view.byteLength - this.#offset);
          const reader = new StandardTypeReader(buffer);
          return new (typeReaders.get(${JSON.stringify(type.name ?? rootClassName)}))(reader);
        }

        // return a plain javascript object of the message
        // This fully deserializes all fields of the message into native types
        // Typed arrays are considered native types and remain as typed arrays
        toObject() {
          const view = this.#view;
          const buffer = new Uint8Array(view.buffer, view.byteOffset + this.#offset, view.byteLength - this.#offset);
          const reader = new StandardTypeReader(buffer);
          return new (typeReaders.get(${JSON.stringify(type.name ?? rootClassName)}))(reader);
        }

        ${type.definitions.map(getterFunction).join("\n")}
    }`;
        classes.push(messageSrc);
      }
      const src = classes.reverse().join("\n\n");
      const typeReaders = (0, _1.createParsers)({ definitions, topLevelReaderKey: rootClassName });
      const wrapFn = new Function("deserializers", "builtinSizes", "typeReaders", "StandardTypeReader", `${src}
return __RootMsg;`);
      const rootMsg = wrapFn.call(void 0, BuiltinDeserialize_1.deserializers, builtinSizes, typeReaders, _1.StandardTypeReader);
      rootMsg.source = () => wrapFn.toString();
      return rootMsg;
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/LazyMessageReader.js
var require_LazyMessageReader = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/LazyMessageReader.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.LazyMessageReader = void 0;
    var buildReader_1 = __importDefault(require_buildReader());
    function isBigEndian() {
      const array = new Uint8Array(4);
      const view = new Uint32Array(array.buffer);
      view[0] = 1;
      return array[3] === 1;
    }
    var isLittleEndian = !isBigEndian();
    if (!isLittleEndian) {
      throw new Error("Only Little Endian architectures are supported");
    }
    var LazyMessageReader = class {
      readerImpl;
      definitions;
      constructor(definitions) {
        this.readerImpl = (0, buildReader_1.default)(definitions);
        this.definitions = definitions;
      }
      // Return the size of our message within the buffer
      size(buffer) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return this.readerImpl.size(view);
      }
      source() {
        return this.readerImpl.source();
      }
      // Create a LazyMessage for the buffer
      // We template on R here for call site type information if the class type information T is not
      // known or available
      readMessage(buffer) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return this.readerImpl.build(view);
      }
    };
    exports2.LazyMessageReader = LazyMessageReader;
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/MessageReader.js
var require_MessageReader2 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/MessageReader.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MessageReader = exports2.createParsers = exports2.StandardTypeReader = void 0;
    var decodeString_1 = __importDefault(require_decodeString());
    var StandardTypeReader = class {
      buffer;
      offset;
      view;
      constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
        this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      }
      json() {
        const resultString = this.string();
        try {
          return JSON.parse(resultString);
        } catch {
          return `Could not parse ${resultString}`;
        }
      }
      string() {
        const len = this.uint32();
        const totalOffset = this.view.byteOffset + this.offset;
        const maxLen = this.view.byteLength - this.offset;
        if (len < 0 || len > maxLen) {
          throw new RangeError(`String deserialization error: length ${len}, maxLength ${maxLen}`);
        }
        const data = new Uint8Array(this.view.buffer, totalOffset, len);
        this.offset += len;
        return (0, decodeString_1.default)(data);
      }
      bool() {
        return this.uint8() !== 0;
      }
      int8() {
        return this.view.getInt8(this.offset++);
      }
      uint8() {
        return this.view.getUint8(this.offset++);
      }
      typedArray(len, TypedArrayConstructor) {
        const arrayLength = len ?? this.uint32();
        const view = this.view;
        const totalOffset = this.offset + view.byteOffset;
        this.offset += arrayLength * TypedArrayConstructor.BYTES_PER_ELEMENT;
        if (totalOffset % TypedArrayConstructor.BYTES_PER_ELEMENT === 0) {
          return new TypedArrayConstructor(view.buffer, totalOffset, arrayLength);
        }
        const size = TypedArrayConstructor.BYTES_PER_ELEMENT * arrayLength;
        const copy = new Uint8Array(size);
        copy.set(new Uint8Array(view.buffer, totalOffset, size));
        return new TypedArrayConstructor(copy.buffer, copy.byteOffset, arrayLength);
      }
      int16() {
        const result = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return result;
      }
      uint16() {
        const result = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return result;
      }
      int32() {
        const result = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return result;
      }
      uint32() {
        const result = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return result;
      }
      float32() {
        const result = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return result;
      }
      float64() {
        const result = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return result;
      }
      int64() {
        const offset = this.offset;
        this.offset += 8;
        return this.view.getBigInt64(offset, true);
      }
      uint64() {
        const offset = this.offset;
        this.offset += 8;
        return this.view.getBigUint64(offset, true);
      }
      time() {
        const offset = this.offset;
        this.offset += 8;
        const sec = this.view.getUint32(offset, true);
        const nsec = this.view.getUint32(offset + 4, true);
        return { sec, nsec };
      }
      duration() {
        const offset = this.offset;
        this.offset += 8;
        const sec = this.view.getInt32(offset, true);
        const nsec = this.view.getInt32(offset + 4, true);
        return { sec, nsec };
      }
    };
    exports2.StandardTypeReader = StandardTypeReader;
    var findTypeByName2 = (types2, name = "") => {
      let foundName = "";
      const matches = types2.filter((type) => {
        const typeName = type.name ?? "";
        if (!name) {
          return !typeName;
        }
        const nameEnd = name.includes("/") ? name : `/${name}`;
        if (typeName.endsWith(nameEnd)) {
          foundName = typeName;
          return true;
        }
        return false;
      });
      if (matches.length !== 1) {
        throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}.`);
      }
      return { ...matches[0], name: foundName };
    };
    var friendlyName2 = (name) => name.replace(/\//g, "_");
    function toTypedArrayType(rosType) {
      switch (rosType) {
        case "int8":
          return "Int8Array";
        case "uint8":
          return "Uint8Array";
        case "int16":
          return "Int16Array";
        case "uint16":
          return "Uint16Array";
        case "int32":
          return "Int32Array";
        case "uint32":
          return "Uint32Array";
        case "int64":
          return "BigInt64Array";
        case "uint64":
          return "BigUint64Array";
        case "float32":
          return "Float32Array";
        case "float64":
          return "Float64Array";
        default:
          return void 0;
      }
    }
    var createParsers = ({ definitions, options = {}, topLevelReaderKey }) => {
      if (definitions.length === 0) {
        throw new Error(`no types given`);
      }
      const unnamedTypes2 = definitions.filter((type) => !type.name);
      if (unnamedTypes2.length > 1) {
        throw new Error("multiple unnamed types");
      }
      const unnamedType2 = unnamedTypes2.length > 0 ? unnamedTypes2[0] : definitions[0];
      const namedTypes2 = definitions.filter((type) => !!type.name);
      const constructorBody2 = (type) => {
        const readerLines = [];
        type.definitions.forEach((def) => {
          if (def.isConstant === true) {
            return;
          }
          if (def.isArray === true) {
            const typedArrayType = toTypedArrayType(def.type);
            if (typedArrayType != void 0) {
              readerLines.push(`this.${def.name} = reader.typedArray(${String(def.arrayLength)}, ${typedArrayType});`);
              return;
            }
            const lenField = `length_${def.name}`;
            readerLines.push(`var ${lenField} = ${def.arrayLength ?? "reader.uint32();"}`);
            const arrayName = `this.${def.name}`;
            readerLines.push(`${arrayName} = new Array(${lenField})`);
            readerLines.push(`for (var i = 0; i < ${lenField}; i++) {`);
            if (def.isComplex === true) {
              const defType = findTypeByName2(definitions, def.type);
              readerLines.push(`  ${arrayName}[i] = new Record.${friendlyName2(defType.name)}(reader);`);
            } else {
              readerLines.push(`  ${arrayName}[i] = reader.${def.type}();`);
            }
            readerLines.push("}");
          } else if (def.isComplex === true) {
            const defType = findTypeByName2(definitions, def.type);
            readerLines.push(`this.${def.name} = new Record.${friendlyName2(defType.name)}(reader);`);
          } else {
            readerLines.push(`this.${def.name} = reader.${def.type}();`);
          }
        });
        if (options.freeze === true) {
          readerLines.push("Object.freeze(this);");
        }
        return readerLines.join("\n    ");
      };
      let js = `
  const builtReaders = new Map();
  var Record = function (reader) {
    ${constructorBody2(unnamedType2)}
  };
  builtReaders.set(topLevelReaderKey, Record);
  `;
      for (const type of namedTypes2) {
        js += `
  Record.${friendlyName2(type.name)} = function(reader) {
    ${constructorBody2(type)}
  };
  builtReaders.set(${JSON.stringify(type.name)}, Record.${friendlyName2(type.name)});
  `;
      }
      js += `return builtReaders;`;
      return new Function("topLevelReaderKey", js)(topLevelReaderKey);
    };
    exports2.createParsers = createParsers;
    var MessageReader3 = class {
      reader;
      #lastReadByteLength = 0;
      #lastReadHadTrailingBytes = false;
      /**
       * True when the most recent decode finished before reaching the end of the buffer. This can
       * signal a schema/payload version mismatch.
       */
      lastReadHadTrailingBytes() {
        return this.#lastReadHadTrailingBytes;
      }
      /**
       * Number of bytes consumed by the most recent decode.
       */
      lastReadByteLength() {
        return this.#lastReadByteLength;
      }
      // takes an object message definition and returns
      // a message reader which can be used to read messages based
      // on the message definition
      constructor(definitions, options = {}) {
        this.reader = (0, exports2.createParsers)({ definitions, options, topLevelReaderKey: "<toplevel>" }).get("<toplevel>");
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
      readMessage(buffer) {
        const standardReaders = new StandardTypeReader(buffer);
        const value = new this.reader(standardReaders);
        this.#lastReadByteLength = standardReaders.offset;
        this.#lastReadHadTrailingBytes = this.#lastReadByteLength < buffer.byteLength;
        return value;
      }
    };
    exports2.MessageReader = MessageReader3;
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/stringLengthUtf8.js
var require_stringLengthUtf8 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/stringLengthUtf8.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.stringLengthUtf8 = stringLengthUtf8;
    function stringLengthUtf8(str) {
      let byteLength = 0;
      const numCodeUnits = str.length;
      for (let i = 0; i < numCodeUnits; i++) {
        const codeUnit = str.charCodeAt(i);
        if (codeUnit <= 127) {
          byteLength += 1;
        } else if (codeUnit <= 2047) {
          byteLength += 2;
        } else if (55296 <= codeUnit && codeUnit <= 56319) {
          const nextCodeUnit = str.charCodeAt(i + 1);
          if (56320 <= nextCodeUnit && nextCodeUnit <= 57343) {
            byteLength += 4;
            i++;
          } else {
            byteLength += 3;
          }
        } else {
          byteLength += 3;
        }
      }
      return byteLength;
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/MessageWriter.js
var require_MessageWriter2 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/MessageWriter.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MessageWriter = void 0;
    var stringLengthUtf8_1 = require_stringLengthUtf8();
    function writeTime(time, view, offset) {
      view.setUint32(offset, time.sec, true);
      view.setUint32(offset + 4, time.nsec, true);
    }
    var StandardTypeOffsetCalculator = class {
      offset = 0;
      // Returns the current offset and increments the next offset by `byteCount`.
      _incrementAndReturn(byteCount) {
        const offset = this.offset;
        this.offset += byteCount;
        return offset;
      }
      // These are not actually used in the StandardTypeWriter, so they must be kept in sync with those implementations.
      json(value) {
        return this.string(JSON.stringify(value));
      }
      // The following are used in the StandardTypeWriter.
      string(value) {
        if (typeof value !== "string") {
          throw new Error(`Expected string but got ${typeof value}`);
        }
        const length = 4 + (0, stringLengthUtf8_1.stringLengthUtf8)(value);
        return this._incrementAndReturn(length);
      }
      bool() {
        return this.uint8();
      }
      int8() {
        return this._incrementAndReturn(1);
      }
      uint8() {
        return this._incrementAndReturn(1);
      }
      int16() {
        return this._incrementAndReturn(2);
      }
      uint16() {
        return this._incrementAndReturn(2);
      }
      int32() {
        return this._incrementAndReturn(4);
      }
      uint32() {
        return this._incrementAndReturn(4);
      }
      float32() {
        return this._incrementAndReturn(4);
      }
      float64() {
        return this._incrementAndReturn(8);
      }
      int64() {
        return this._incrementAndReturn(8);
      }
      uint64() {
        return this._incrementAndReturn(8);
      }
      time() {
        return this._incrementAndReturn(8);
      }
      duration() {
        return this._incrementAndReturn(8);
      }
    };
    var StandardTypeWriter = class {
      data;
      view;
      textEncoder;
      offsetCalculator;
      constructor(data) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.offsetCalculator = new StandardTypeOffsetCalculator();
      }
      json(value) {
        this.string(JSON.stringify(value));
      }
      string(value) {
        this.textEncoder ??= new TextEncoder();
        const stringOffset = this.offsetCalculator.string(value);
        const stringLength = this.offsetCalculator.offset - stringOffset - 4;
        this.view.setUint32(stringOffset, stringLength, true);
        const { read, written } = this.textEncoder.encodeInto(value, this.data.subarray(stringOffset + 4));
        if (read !== value.length) {
          throw new Error(`Not enough space to encode string into subarray (wrote ${read} of ${value.length} code units into ${written} of ${this.data.subarray(stringOffset + 4).length} bytes)`);
        }
      }
      // eslint-disable-next-line @foxglove/no-boolean-parameters
      bool(value) {
        this.uint8(value ? 1 : 0);
      }
      int8(value) {
        this.view.setInt8(this.offsetCalculator.int8(), value);
      }
      uint8(value) {
        this.view.setUint8(this.offsetCalculator.uint8(), value);
      }
      int16(value) {
        this.view.setInt16(this.offsetCalculator.int16(), value, true);
      }
      uint16(value) {
        this.view.setUint16(this.offsetCalculator.uint16(), value, true);
      }
      int32(value) {
        this.view.setInt32(this.offsetCalculator.int32(), value, true);
      }
      uint32(value) {
        this.view.setUint32(this.offsetCalculator.uint32(), value, true);
      }
      float32(value) {
        this.view.setFloat32(this.offsetCalculator.float32(), value, true);
      }
      float64(value) {
        this.view.setFloat64(this.offsetCalculator.float64(), value, true);
      }
      int64(value) {
        this.view.setBigInt64(this.offsetCalculator.int64(), BigInt(value), true);
      }
      uint64(value) {
        this.view.setBigUint64(this.offsetCalculator.uint64(), BigInt(value), true);
      }
      time(time) {
        writeTime(time, this.view, this.offsetCalculator.time());
      }
      duration(time) {
        writeTime(time, this.view, this.offsetCalculator.time());
      }
    };
    var findTypeByName = (types2, name = "") => {
      let foundName = "";
      const matches = types2.filter((type) => {
        const typeName = type.name ?? "";
        if (name.length === 0) {
          return typeName.length === 0;
        }
        const nameEnd = name.includes("/") ? name : `/${name}`;
        if (typeName.endsWith(nameEnd)) {
          foundName = typeName;
          return true;
        }
        return false;
      });
      if (matches.length !== 1) {
        throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}.`);
      }
      return { ...matches[0], name: foundName };
    };
    var friendlyName = (name) => name.replace(/\//g, "_");
    function createWriterAndSizeCalculator(types) {
      if (types.length === 0) {
        throw new Error(`no types given`);
      }
      const unnamedTypes = types.filter((type) => type.name == void 0);
      if (unnamedTypes.length > 1) {
        throw new Error("multiple unnamed types");
      }
      const unnamedType = unnamedTypes.length > 0 ? unnamedTypes[0] : types[0];
      const namedTypes = types.filter((type) => type.name != void 0);
      const constructorBody = (type, argName) => {
        const lines = [];
        type.definitions.forEach((def) => {
          if (def.isConstant ?? false) {
            return;
          }
          const accessMessageField = `message["${def.name}"]`;
          if (def.isArray ?? false) {
            const lenField = `length_${def.name}`;
            if (def.arrayLength != void 0) {
              lines.push(`var ${lenField} = ${def.arrayLength};`);
            } else {
              lines.push(`var ${lenField} = ${accessMessageField}.length;`);
              lines.push(`${argName}.uint32(${lenField});`);
            }
            lines.push(`for (var i = 0; i < ${lenField}; i++) {`);
            if (def.isComplex ?? false) {
              const defType = findTypeByName(types, def.type);
              lines.push(`  ${friendlyName(defType.name)}(${argName}, ${accessMessageField}[i]);`);
            } else {
              lines.push(`  ${argName}.${def.type}(${accessMessageField}[i]);`);
            }
            lines.push("}");
          } else if (def.isComplex ?? false) {
            const defType = findTypeByName(types, def.type);
            lines.push(`${friendlyName(defType.name)}(${argName}, ${accessMessageField});`);
          } else {
            lines.push(`${argName}.${def.type}(${accessMessageField});`);
          }
        });
        return lines.join("\n    ");
      };
      let writerJs = "";
      let calculateSizeJs = "";
      namedTypes.forEach((t) => {
        writerJs += `
  function ${friendlyName(t.name)}(writer, message) {
    ${constructorBody(t, "writer")}
  };
`;
        calculateSizeJs += `
  function ${friendlyName(t.name)}(offsetCalculator, message) {
    ${constructorBody(t, "offsetCalculator")}
  };
`;
      });
      writerJs += `
  return function write(writer, message) {
    ${constructorBody(unnamedType, "writer")}
    return writer.data;
  };`;
      calculateSizeJs += `
  return function calculateSize(offsetCalculator, message) {
    ${constructorBody(unnamedType, "offsetCalculator")}
    return offsetCalculator.offset;
  };`;
      let write;
      let calculateSize;
      try {
        write = eval(`(function buildWriter() { ${writerJs} })()`);
      } catch (e) {
        console.error("error building writer:", writerJs);
        throw e;
      }
      try {
        calculateSize = eval(`(function buildSizeCalculator() { ${calculateSizeJs} })()`);
      } catch (e) {
        console.error("error building size calculator:", calculateSizeJs);
        throw e;
      }
      return {
        writer(message, data) {
          const writer = new StandardTypeWriter(data);
          return write(writer, message);
        },
        byteSizeCalculator(message) {
          const offsetCalculator = new StandardTypeOffsetCalculator();
          return calculateSize(offsetCalculator, message);
        }
      };
    }
    var MessageWriter = class {
      writer;
      byteSizeCalculator;
      // takes an object string message definition and returns
      // a message writer which can be used to write messages based
      // on the message definition
      constructor(definitions) {
        const { writer, byteSizeCalculator } = createWriterAndSizeCalculator(definitions);
        this.writer = writer;
        this.byteSizeCalculator = byteSizeCalculator;
      }
      // Calculates the byte size needed to write this message in bytes.
      calculateByteSize(message) {
        return this.byteSizeCalculator(message);
      }
      // output is optional - if it is not provided, a Uint8Array will be generated.
      writeMessage(message, output) {
        return this.writer(message, output ?? new Uint8Array(this.calculateByteSize(message)));
      }
    };
    exports.MessageWriter = MessageWriter;
  }
});

// node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/index.js
var require_cjs = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg-serialization@2.1.1/node_modules/@foxglove/rosmsg-serialization/dist/cjs/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_LazyMessageReader(), exports2);
    __exportStar(require_MessageReader2(), exports2);
    __exportStar(require_MessageWriter2(), exports2);
  }
});

// node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.js
var require_sql_wasm = __commonJS({
  "node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.js"(exports2, module2) {
    var initSqlJsPromise = void 0;
    var initSqlJs = function(moduleConfig) {
      if (initSqlJsPromise) {
        return initSqlJsPromise;
      }
      initSqlJsPromise = new Promise(function(resolveModule, reject) {
        var Module = typeof moduleConfig !== "undefined" ? moduleConfig : {};
        var originalOnAbortFunction = Module["onAbort"];
        Module["onAbort"] = function(errorThatCausedAbort) {
          reject(new Error(errorThatCausedAbort));
          if (originalOnAbortFunction) {
            originalOnAbortFunction(errorThatCausedAbort);
          }
        };
        Module["postRun"] = Module["postRun"] || [];
        Module["postRun"].push(function() {
          resolveModule(Module);
        });
        module2 = void 0;
        var k;
        k ||= typeof Module != "undefined" ? Module : {};
        var aa = !!globalThis.window, ba = !!globalThis.WorkerGlobalScope, ca = globalThis.process?.versions?.node && "renderer" != globalThis.process?.type;
        k.onRuntimeInitialized = function() {
          function a(f2, l) {
            switch (typeof l) {
              case "boolean":
                bc(f2, l ? 1 : 0);
                break;
              case "number":
                cc(f2, l);
                break;
              case "string":
                dc(f2, l, -1, -1);
                break;
              case "object":
                if (null === l) lb(f2);
                else if (null != l.length) {
                  var n = da(l.length);
                  m.set(l, n);
                  ec2(f2, n, l.length, -1);
                  ea(n);
                } else sa(f2, "Wrong API use : tried to return a value of an unknown type (" + l + ").", -1);
                break;
              default:
                lb(f2);
            }
          }
          function b(f2, l) {
            for (var n = [], p = 0; p < f2; p += 1) {
              var u = r(l + 4 * p, "i32"), v = fc(u);
              if (1 === v || 2 === v) u = gc(u);
              else if (3 === v) u = hc(u);
              else if (4 === v) {
                v = u;
                u = ic(v);
                v = jc(v);
                for (var K = new Uint8Array(u), I = 0; I < u; I += 1) K[I] = m[v + I];
                u = K;
              } else u = null;
              n.push(u);
            }
            return n;
          }
          function c(f2, l) {
            this.Qa = f2;
            this.db = l;
            this.Oa = 1;
            this.mb = [];
          }
          function d(f2, l) {
            this.db = l;
            this.fb = fa(f2);
            if (null === this.fb) throw Error("Unable to allocate memory for the SQL string");
            this.lb = this.fb;
            this.$a = this.sb = null;
          }
          function e(f2) {
            this.filename = "dbfile_" + (4294967295 * Math.random() >>> 0);
            if (null != f2) {
              var l = this.filename, n = "/", p = l;
              n && (n = "string" == typeof n ? n : ha(n), p = l ? ia(n + "/" + l) : n);
              l = ja(true, true);
              p = ka(
                p,
                l
              );
              if (f2) {
                if ("string" == typeof f2) {
                  n = Array(f2.length);
                  for (var u = 0, v = f2.length; u < v; ++u) n[u] = f2.charCodeAt(u);
                  f2 = n;
                }
                la(p, l | 146);
                n = ma(p, 577);
                na(n, f2, 0, f2.length, 0);
                oa(n);
                la(p, l);
              }
            }
            this.handleError(q(this.filename, g));
            this.db = r(g, "i32");
            ob(this.db);
            this.gb = {};
            this.Sa = {};
          }
          var g = y(4), h = k.cwrap, q = h("sqlite3_open", "number", ["string", "number"]), w = h("sqlite3_close_v2", "number", ["number"]), t = h("sqlite3_exec", "number", ["number", "string", "number", "number", "number"]), x = h("sqlite3_changes", "number", ["number"]), D = h(
            "sqlite3_prepare_v2",
            "number",
            ["number", "string", "number", "number", "number"]
          ), pb = h("sqlite3_sql", "string", ["number"]), lc = h("sqlite3_normalized_sql", "string", ["number"]), qb = h("sqlite3_prepare_v2", "number", ["number", "number", "number", "number", "number"]), mc = h("sqlite3_bind_text", "number", ["number", "number", "number", "number", "number"]), rb2 = h("sqlite3_bind_blob", "number", ["number", "number", "number", "number", "number"]), nc = h("sqlite3_bind_double", "number", ["number", "number", "number"]), oc = h("sqlite3_bind_int", "number", [
            "number",
            "number",
            "number"
          ]), pc = h("sqlite3_bind_parameter_index", "number", ["number", "string"]), qc = h("sqlite3_step", "number", ["number"]), rc = h("sqlite3_errmsg", "string", ["number"]), sc = h("sqlite3_column_count", "number", ["number"]), tc = h("sqlite3_data_count", "number", ["number"]), uc = h("sqlite3_column_double", "number", ["number", "number"]), sb = h("sqlite3_column_text", "string", ["number", "number"]), vc = h("sqlite3_column_blob", "number", ["number", "number"]), wc = h("sqlite3_column_bytes", "number", ["number", "number"]), xc = h(
            "sqlite3_column_type",
            "number",
            ["number", "number"]
          ), yc = h("sqlite3_column_name", "string", ["number", "number"]), zc = h("sqlite3_reset", "number", ["number"]), Ac = h("sqlite3_clear_bindings", "number", ["number"]), Bc = h("sqlite3_finalize", "number", ["number"]), tb = h("sqlite3_create_function_v2", "number", "number string number number number number number number number".split(" ")), fc = h("sqlite3_value_type", "number", ["number"]), ic = h("sqlite3_value_bytes", "number", ["number"]), hc = h("sqlite3_value_text", "string", ["number"]), jc = h(
            "sqlite3_value_blob",
            "number",
            ["number"]
          ), gc = h("sqlite3_value_double", "number", ["number"]), cc = h("sqlite3_result_double", "", ["number", "number"]), lb = h("sqlite3_result_null", "", ["number"]), dc = h("sqlite3_result_text", "", ["number", "string", "number", "number"]), ec2 = h("sqlite3_result_blob", "", ["number", "number", "number", "number"]), bc = h("sqlite3_result_int", "", ["number", "number"]), sa = h("sqlite3_result_error", "", ["number", "string", "number"]), ub = h("sqlite3_aggregate_context", "number", ["number", "number"]), ob = h(
            "RegisterExtensionFunctions",
            "number",
            ["number"]
          ), vb = h("sqlite3_update_hook", "number", ["number", "number", "number"]);
          c.prototype.bind = function(f2) {
            if (!this.Qa) throw "Statement closed";
            this.reset();
            return Array.isArray(f2) ? this.Gb(f2) : null != f2 && "object" === typeof f2 ? this.Hb(f2) : true;
          };
          c.prototype.step = function() {
            if (!this.Qa) throw "Statement closed";
            this.Oa = 1;
            var f2 = qc(this.Qa);
            switch (f2) {
              case 100:
                return true;
              case 101:
                return false;
              default:
                throw this.db.handleError(f2);
            }
          };
          c.prototype.Ab = function(f2) {
            null == f2 && (f2 = this.Oa, this.Oa += 1);
            return uc(this.Qa, f2);
          };
          c.prototype.Ob = function(f2) {
            null == f2 && (f2 = this.Oa, this.Oa += 1);
            f2 = sb(this.Qa, f2);
            if ("function" !== typeof BigInt) throw Error("BigInt is not supported");
            return BigInt(f2);
          };
          c.prototype.Tb = function(f2) {
            null == f2 && (f2 = this.Oa, this.Oa += 1);
            return sb(this.Qa, f2);
          };
          c.prototype.getBlob = function(f2) {
            null == f2 && (f2 = this.Oa, this.Oa += 1);
            var l = wc(this.Qa, f2);
            f2 = vc(this.Qa, f2);
            for (var n = new Uint8Array(l), p = 0; p < l; p += 1) n[p] = m[f2 + p];
            return n;
          };
          c.prototype.get = function(f2, l) {
            l = l || {};
            null != f2 && this.bind(f2) && this.step();
            f2 = [];
            for (var n = tc(this.Qa), p = 0; p < n; p += 1) switch (xc(this.Qa, p)) {
              case 1:
                var u = l.useBigInt ? this.Ob(p) : this.Ab(p);
                f2.push(u);
                break;
              case 2:
                f2.push(this.Ab(p));
                break;
              case 3:
                f2.push(this.Tb(p));
                break;
              case 4:
                f2.push(this.getBlob(p));
                break;
              default:
                f2.push(null);
            }
            return f2;
          };
          c.prototype.qb = function() {
            for (var f2 = [], l = sc(this.Qa), n = 0; n < l; n += 1) f2.push(yc(this.Qa, n));
            return f2;
          };
          c.prototype.zb = function(f2, l) {
            f2 = this.get(f2, l);
            l = this.qb();
            for (var n = {}, p = 0; p < l.length; p += 1) n[l[p]] = f2[p];
            return n;
          };
          c.prototype.Sb = function() {
            return pb(this.Qa);
          };
          c.prototype.Pb = function() {
            return lc(this.Qa);
          };
          c.prototype.run = function(f2) {
            null != f2 && this.bind(f2);
            this.step();
            return this.reset();
          };
          c.prototype.wb = function(f2, l) {
            null == l && (l = this.Oa, this.Oa += 1);
            f2 = fa(f2);
            this.mb.push(f2);
            this.db.handleError(mc(this.Qa, l, f2, -1, 0));
          };
          c.prototype.Fb = function(f2, l) {
            null == l && (l = this.Oa, this.Oa += 1);
            var n = da(f2.length);
            m.set(f2, n);
            this.mb.push(n);
            this.db.handleError(rb2(this.Qa, l, n, f2.length, 0));
          };
          c.prototype.vb = function(f2, l) {
            null == l && (l = this.Oa, this.Oa += 1);
            this.db.handleError((f2 === (f2 | 0) ? oc : nc)(
              this.Qa,
              l,
              f2
            ));
          };
          c.prototype.Ib = function(f2) {
            null == f2 && (f2 = this.Oa, this.Oa += 1);
            rb2(this.Qa, f2, 0, 0, 0);
          };
          c.prototype.xb = function(f2, l) {
            null == l && (l = this.Oa, this.Oa += 1);
            switch (typeof f2) {
              case "string":
                this.wb(f2, l);
                return;
              case "number":
                this.vb(f2, l);
                return;
              case "bigint":
                this.wb(f2.toString(), l);
                return;
              case "boolean":
                this.vb(f2 + 0, l);
                return;
              case "object":
                if (null === f2) {
                  this.Ib(l);
                  return;
                }
                if (null != f2.length) {
                  this.Fb(f2, l);
                  return;
                }
            }
            throw "Wrong API use : tried to bind a value of an unknown type (" + f2 + ").";
          };
          c.prototype.Hb = function(f2) {
            var l = this;
            Object.keys(f2).forEach(function(n) {
              var p = pc(l.Qa, n);
              0 !== p && l.xb(f2[n], p);
            });
            return true;
          };
          c.prototype.Gb = function(f2) {
            for (var l = 0; l < f2.length; l += 1) this.xb(f2[l], l + 1);
            return true;
          };
          c.prototype.reset = function() {
            this.freemem();
            return 0 === Ac(this.Qa) && 0 === zc(this.Qa);
          };
          c.prototype.freemem = function() {
            for (var f2; void 0 !== (f2 = this.mb.pop()); ) ea(f2);
          };
          c.prototype.Ya = function() {
            this.freemem();
            var f2 = 0 === Bc(this.Qa);
            delete this.db.gb[this.Qa];
            this.Qa = 0;
            return f2;
          };
          d.prototype.next = function() {
            if (null === this.fb) return { done: true };
            null !== this.$a && (this.$a.Ya(), this.$a = null);
            if (!this.db.db) throw this.ob(), Error("Database closed");
            var f2 = pa(), l = y(4);
            qa(g);
            qa(l);
            try {
              this.db.handleError(qb(this.db.db, this.lb, -1, g, l));
              this.lb = r(l, "i32");
              var n = r(g, "i32");
              if (0 === n) return this.ob(), { done: true };
              this.$a = new c(n, this.db);
              this.db.gb[n] = this.$a;
              return { value: this.$a, done: false };
            } catch (p) {
              throw this.sb = z(this.lb), this.ob(), p;
            } finally {
              ra(f2);
            }
          };
          d.prototype.ob = function() {
            ea(this.fb);
            this.fb = null;
          };
          d.prototype.Qb = function() {
            return null !== this.sb ? this.sb : z(this.lb);
          };
          "function" === typeof Symbol && "symbol" === typeof Symbol.iterator && (d.prototype[Symbol.iterator] = function() {
            return this;
          });
          e.prototype.run = function(f2, l) {
            if (!this.db) throw "Database closed";
            if (l) {
              f2 = this.tb(f2, l);
              try {
                f2.step();
              } finally {
                f2.Ya();
              }
            } else this.handleError(t(this.db, f2, 0, 0, g));
            return this;
          };
          e.prototype.exec = function(f2, l, n) {
            if (!this.db) throw "Database closed";
            var p = null, u = null, v = null;
            try {
              v = u = fa(f2);
              var K = y(4);
              for (f2 = []; 0 !== r(v, "i8"); ) {
                qa(g);
                qa(K);
                this.handleError(qb(this.db, v, -1, g, K));
                var I = r(
                  g,
                  "i32"
                );
                v = r(K, "i32");
                if (0 !== I) {
                  var H = null;
                  p = new c(I, this);
                  for (null != l && p.bind(l); p.step(); ) null === H && (H = { columns: p.qb(), values: [] }, f2.push(H)), H.values.push(p.get(null, n));
                  p.Ya();
                }
              }
              return f2;
            } catch (L) {
              throw p && p.Ya(), L;
            } finally {
              u && ea(u);
            }
          };
          e.prototype.Mb = function(f2, l, n, p, u) {
            "function" === typeof l && (p = n, n = l, l = void 0);
            f2 = this.tb(f2, l);
            try {
              for (; f2.step(); ) n(f2.zb(null, u));
            } finally {
              f2.Ya();
            }
            if ("function" === typeof p) return p();
          };
          e.prototype.tb = function(f2, l) {
            qa(g);
            this.handleError(D(this.db, f2, -1, g, 0));
            f2 = r(g, "i32");
            if (0 === f2) throw "Nothing to prepare";
            var n = new c(f2, this);
            null != l && n.bind(l);
            return this.gb[f2] = n;
          };
          e.prototype.Ub = function(f2) {
            return new d(f2, this);
          };
          e.prototype.Nb = function() {
            Object.values(this.gb).forEach(function(l) {
              l.Ya();
            });
            Object.values(this.Sa).forEach(A);
            this.Sa = {};
            this.handleError(w(this.db));
            var f2 = ta(this.filename);
            this.handleError(q(this.filename, g));
            this.db = r(g, "i32");
            ob(this.db);
            return f2;
          };
          e.prototype.close = function() {
            null !== this.db && (Object.values(this.gb).forEach(function(f2) {
              f2.Ya();
            }), Object.values(this.Sa).forEach(A), this.Sa = {}, this.Za && (A(this.Za), this.Za = void 0), this.handleError(w(this.db)), ua("/" + this.filename), this.db = null);
          };
          e.prototype.handleError = function(f2) {
            if (0 === f2) return null;
            f2 = rc(this.db);
            throw Error(f2);
          };
          e.prototype.Rb = function() {
            return x(this.db);
          };
          e.prototype.Kb = function(f2, l) {
            Object.prototype.hasOwnProperty.call(this.Sa, f2) && (A(this.Sa[f2]), delete this.Sa[f2]);
            var n = va(function(p, u, v) {
              u = b(u, v);
              try {
                var K = l.apply(null, u);
              } catch (I) {
                sa(p, I, -1);
                return;
              }
              a(p, K);
            }, "viii");
            this.Sa[f2] = n;
            this.handleError(tb(
              this.db,
              f2,
              l.length,
              1,
              0,
              n,
              0,
              0,
              0
            ));
            return this;
          };
          e.prototype.Jb = function(f2, l) {
            var n = l.init || function() {
              return null;
            }, p = l.finalize || function(H) {
              return H;
            }, u = l.step;
            if (!u) throw "An aggregate function must have a step function in " + f2;
            var v = {};
            Object.hasOwnProperty.call(this.Sa, f2) && (A(this.Sa[f2]), delete this.Sa[f2]);
            l = f2 + "__finalize";
            Object.hasOwnProperty.call(this.Sa, l) && (A(this.Sa[l]), delete this.Sa[l]);
            var K = va(function(H, L, Pa) {
              var V = ub(H, 1);
              Object.hasOwnProperty.call(v, V) || (v[V] = n());
              L = b(L, Pa);
              L = [v[V]].concat(L);
              try {
                v[V] = u.apply(null, L);
              } catch (Dc) {
                delete v[V], sa(H, Dc, -1);
              }
            }, "viii"), I = va(function(H) {
              var L = ub(H, 1);
              try {
                var Pa = p(v[L]);
              } catch (V) {
                delete v[L];
                sa(H, V, -1);
                return;
              }
              a(H, Pa);
              delete v[L];
            }, "vi");
            this.Sa[f2] = K;
            this.Sa[l] = I;
            this.handleError(tb(this.db, f2, u.length - 1, 1, 0, 0, K, I, 0));
            return this;
          };
          e.prototype.Zb = function(f2) {
            this.Za && (vb(this.db, 0, 0), A(this.Za), this.Za = void 0);
            if (!f2) return this;
            this.Za = va(function(l, n, p, u, v) {
              switch (n) {
                case 18:
                  l = "insert";
                  break;
                case 23:
                  l = "update";
                  break;
                case 9:
                  l = "delete";
                  break;
                default:
                  throw "unknown operationCode in updateHook callback: " + n;
              }
              p = z(p);
              u = z(u);
              if (v > Number.MAX_SAFE_INTEGER) throw "rowId too big to fit inside a Number";
              f2(l, p, u, Number(v));
            }, "viiiij");
            vb(this.db, this.Za, 0);
            return this;
          };
          c.prototype.bind = c.prototype.bind;
          c.prototype.step = c.prototype.step;
          c.prototype.get = c.prototype.get;
          c.prototype.getColumnNames = c.prototype.qb;
          c.prototype.getAsObject = c.prototype.zb;
          c.prototype.getSQL = c.prototype.Sb;
          c.prototype.getNormalizedSQL = c.prototype.Pb;
          c.prototype.run = c.prototype.run;
          c.prototype.reset = c.prototype.reset;
          c.prototype.freemem = c.prototype.freemem;
          c.prototype.free = c.prototype.Ya;
          d.prototype.next = d.prototype.next;
          d.prototype.getRemainingSQL = d.prototype.Qb;
          e.prototype.run = e.prototype.run;
          e.prototype.exec = e.prototype.exec;
          e.prototype.each = e.prototype.Mb;
          e.prototype.prepare = e.prototype.tb;
          e.prototype.iterateStatements = e.prototype.Ub;
          e.prototype["export"] = e.prototype.Nb;
          e.prototype.close = e.prototype.close;
          e.prototype.handleError = e.prototype.handleError;
          e.prototype.getRowsModified = e.prototype.Rb;
          e.prototype.create_function = e.prototype.Kb;
          e.prototype.create_aggregate = e.prototype.Jb;
          e.prototype.updateHook = e.prototype.Zb;
          k.Database = e;
        };
        var wa = "./this.program", xa = (a, b) => {
          throw b;
        }, ya = globalThis.document?.currentScript?.src;
        "undefined" != typeof __filename ? ya = __filename : ba && (ya = self.location.href);
        var za = "", Aa, Ba;
        if (ca) {
          var fs = __require("node:fs");
          za = __dirname + "/";
          Ba = (a) => {
            a = Ca(a) ? new URL(a) : a;
            return fs.readFileSync(a);
          };
          Aa = async (a) => {
            a = Ca(a) ? new URL(a) : a;
            return fs.readFileSync(a, void 0);
          };
          1 < process.argv.length && (wa = process.argv[1].replace(/\\/g, "/"));
          process.argv.slice(2);
          "undefined" != typeof module2 && (module2.exports = k);
          xa = (a, b) => {
            process.exitCode = a;
            throw b;
          };
        } else if (aa || ba) {
          try {
            za = new URL(".", ya).href;
          } catch {
          }
          ba && (Ba = (a) => {
            var b = new XMLHttpRequest();
            b.open("GET", a, false);
            b.responseType = "arraybuffer";
            b.send(null);
            return new Uint8Array(b.response);
          });
          Aa = async (a) => {
            if (Ca(a)) return new Promise((c, d) => {
              var e = new XMLHttpRequest();
              e.open("GET", a, true);
              e.responseType = "arraybuffer";
              e.onload = () => {
                200 == e.status || 0 == e.status && e.response ? c(e.response) : d(e.status);
              };
              e.onerror = d;
              e.send(null);
            });
            var b = await fetch(a, { credentials: "same-origin" });
            if (b.ok) return b.arrayBuffer();
            throw Error(b.status + " : " + b.url);
          };
        }
        var Da = console.log.bind(console), B = console.error.bind(console), Ea, Fa = false, Ga, Ca = (a) => a.startsWith("file://"), m, C, Ha, E, F, Ia, Ja, G;
        function Ka() {
          var a = La.buffer;
          m = new Int8Array(a);
          Ha = new Int16Array(a);
          C = new Uint8Array(a);
          new Uint16Array(a);
          E = new Int32Array(a);
          F = new Uint32Array(a);
          Ia = new Float32Array(a);
          Ja = new Float64Array(a);
          G = new BigInt64Array(a);
          new BigUint64Array(a);
        }
        function Ma(a) {
          k.onAbort?.(a);
          a = "Aborted(" + a + ")";
          B(a);
          Fa = true;
          throw new WebAssembly.RuntimeError(a + ". Build with -sASSERTIONS for more info.");
        }
        var Na;
        async function Oa(a) {
          if (!Ea) try {
            var b = await Aa(a);
            return new Uint8Array(b);
          } catch {
          }
          if (a == Na && Ea) a = new Uint8Array(Ea);
          else if (Ba) a = Ba(a);
          else throw "both async and sync fetching of the wasm failed";
          return a;
        }
        async function Qa(a, b) {
          try {
            var c = await Oa(a);
            return await WebAssembly.instantiate(c, b);
          } catch (d) {
            B(`failed to asynchronously prepare wasm: ${d}`), Ma(d);
          }
        }
        async function Ra(a) {
          var b = Na;
          if (!Ea && !Ca(b) && !ca) try {
            var c = fetch(b, { credentials: "same-origin" });
            return await WebAssembly.instantiateStreaming(c, a);
          } catch (d) {
            B(`wasm streaming compile failed: ${d}`), B("falling back to ArrayBuffer instantiation");
          }
          return Qa(b, a);
        }
        class Sa {
          name = "ExitStatus";
          constructor(a) {
            this.message = `Program terminated with exit(${a})`;
            this.status = a;
          }
        }
        var Ta = (a) => {
          for (; 0 < a.length; ) a.shift()(k);
        }, Ua = [], Va = [], Wa = () => {
          var a = k.preRun.shift();
          Va.push(a);
        }, J = 0, Xa = null;
        function r(a, b = "i8") {
          b.endsWith("*") && (b = "*");
          switch (b) {
            case "i1":
              return m[a];
            case "i8":
              return m[a];
            case "i16":
              return Ha[a >> 1];
            case "i32":
              return E[a >> 2];
            case "i64":
              return G[a >> 3];
            case "float":
              return Ia[a >> 2];
            case "double":
              return Ja[a >> 3];
            case "*":
              return F[a >> 2];
            default:
              Ma(`invalid type for getValue: ${b}`);
          }
        }
        var Ya = true;
        function qa(a) {
          var b = "i32";
          b.endsWith("*") && (b = "*");
          switch (b) {
            case "i1":
              m[a] = 0;
              break;
            case "i8":
              m[a] = 0;
              break;
            case "i16":
              Ha[a >> 1] = 0;
              break;
            case "i32":
              E[a >> 2] = 0;
              break;
            case "i64":
              G[a >> 3] = BigInt(0);
              break;
            case "float":
              Ia[a >> 2] = 0;
              break;
            case "double":
              Ja[a >> 3] = 0;
              break;
            case "*":
              F[a >> 2] = 0;
              break;
            default:
              Ma(`invalid type for setValue: ${b}`);
          }
        }
        var Za = new TextDecoder(), $a = (a, b, c, d) => {
          c = b + c;
          if (d) return c;
          for (; a[b] && !(b >= c); ) ++b;
          return b;
        }, z = (a, b, c) => a ? Za.decode(C.subarray(a, $a(C, a, b, c))) : "", ab2 = (a, b) => {
          for (var c = 0, d = a.length - 1; 0 <= d; d--) {
            var e = a[d];
            "." === e ? a.splice(d, 1) : ".." === e ? (a.splice(d, 1), c++) : c && (a.splice(d, 1), c--);
          }
          if (b) for (; c; c--) a.unshift("..");
          return a;
        }, ia = (a) => {
          var b = "/" === a.charAt(0), c = "/" === a.slice(-1);
          (a = ab2(a.split("/").filter((d) => !!d), !b).join("/")) || b || (a = ".");
          a && c && (a += "/");
          return (b ? "/" : "") + a;
        }, bb = (a) => {
          var b = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);
          a = b[0];
          b = b[1];
          if (!a && !b) return ".";
          b &&= b.slice(0, -1);
          return a + b;
        }, cb = (a) => a && a.match(/([^\/]+|\/)\/*$/)[1], db = () => {
          if (ca) {
            var a = __require("node:crypto");
            return (b) => a.randomFillSync(b);
          }
          return (b) => crypto.getRandomValues(b);
        }, eb = (a) => {
          (eb = db())(a);
        }, fb = (...a) => {
          for (var b = "", c = false, d = a.length - 1; -1 <= d && !c; d--) {
            c = 0 <= d ? a[d] : "/";
            if ("string" != typeof c) throw new TypeError("Arguments to path.resolve must be strings");
            if (!c) return "";
            b = c + "/" + b;
            c = "/" === c.charAt(0);
          }
          b = ab2(b.split("/").filter((e) => !!e), !c).join("/");
          return (c ? "/" : "") + b || ".";
        }, gb = (a) => {
          var b = $a(a, 0);
          return Za.decode(a.buffer ? a.subarray(0, b) : new Uint8Array(a.slice(0, b)));
        }, hb = [], ib = (a) => {
          for (var b = 0, c = 0; c < a.length; ++c) {
            var d = a.charCodeAt(c);
            127 >= d ? b++ : 2047 >= d ? b += 2 : 55296 <= d && 57343 >= d ? (b += 4, ++c) : b += 3;
          }
          return b;
        }, M = (a, b, c, d) => {
          if (!(0 < d)) return 0;
          var e = c;
          d = c + d - 1;
          for (var g = 0; g < a.length; ++g) {
            var h = a.codePointAt(g);
            if (127 >= h) {
              if (c >= d) break;
              b[c++] = h;
            } else if (2047 >= h) {
              if (c + 1 >= d) break;
              b[c++] = 192 | h >> 6;
              b[c++] = 128 | h & 63;
            } else if (65535 >= h) {
              if (c + 2 >= d) break;
              b[c++] = 224 | h >> 12;
              b[c++] = 128 | h >> 6 & 63;
              b[c++] = 128 | h & 63;
            } else {
              if (c + 3 >= d) break;
              b[c++] = 240 | h >> 18;
              b[c++] = 128 | h >> 12 & 63;
              b[c++] = 128 | h >> 6 & 63;
              b[c++] = 128 | h & 63;
              g++;
            }
          }
          b[c] = 0;
          return c - e;
        }, jb = [];
        function kb(a, b) {
          jb[a] = { input: [], output: [], eb: b };
          mb(a, nb);
        }
        var nb = { open(a) {
          var b = jb[a.node.rdev];
          if (!b) throw new N(43);
          a.tty = b;
          a.seekable = false;
        }, close(a) {
          a.tty.eb.fsync(a.tty);
        }, fsync(a) {
          a.tty.eb.fsync(a.tty);
        }, read(a, b, c, d) {
          if (!a.tty || !a.tty.eb.Bb) throw new N(60);
          for (var e = 0, g = 0; g < d; g++) {
            try {
              var h = a.tty.eb.Bb(a.tty);
            } catch (q) {
              throw new N(29);
            }
            if (void 0 === h && 0 === e) throw new N(6);
            if (null === h || void 0 === h) break;
            e++;
            b[c + g] = h;
          }
          e && (a.node.atime = Date.now());
          return e;
        }, write(a, b, c, d) {
          if (!a.tty || !a.tty.eb.ub) throw new N(60);
          try {
            for (var e = 0; e < d; e++) a.tty.eb.ub(a.tty, b[c + e]);
          } catch (g) {
            throw new N(29);
          }
          d && (a.node.mtime = a.node.ctime = Date.now());
          return e;
        } }, wb = { Bb() {
          a: {
            if (!hb.length) {
              var a = null;
              if (ca) {
                var b = Buffer.alloc(256), c = 0, d = process.stdin.fd;
                try {
                  c = fs.readSync(d, b, 0, 256);
                } catch (e) {
                  if (e.toString().includes("EOF")) c = 0;
                  else throw e;
                }
                0 < c && (a = b.slice(0, c).toString("utf-8"));
              } else globalThis.window?.prompt && (a = window.prompt("Input: "), null !== a && (a += "\n"));
              if (!a) {
                a = null;
                break a;
              }
              b = Array(ib(a) + 1);
              a = M(a, b, 0, b.length);
              b.length = a;
              hb = b;
            }
            a = hb.shift();
          }
          return a;
        }, ub(a, b) {
          null === b || 10 === b ? (Da(gb(a.output)), a.output = []) : 0 != b && a.output.push(b);
        }, fsync(a) {
          0 < a.output?.length && (Da(gb(a.output)), a.output = []);
        }, hc() {
          return { bc: 25856, dc: 5, ac: 191, cc: 35387, $b: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        }, ic() {
          return 0;
        }, jc() {
          return [24, 80];
        } }, xb = { ub(a, b) {
          null === b || 10 === b ? (B(gb(a.output)), a.output = []) : 0 != b && a.output.push(b);
        }, fsync(a) {
          0 < a.output?.length && (B(gb(a.output)), a.output = []);
        } }, O = { Wa: null, Xa() {
          return O.createNode(null, "/", 16895, 0);
        }, createNode(a, b, c, d) {
          if (24576 === (c & 61440) || 4096 === (c & 61440)) throw new N(63);
          O.Wa || (O.Wa = { dir: { node: { Ta: O.La.Ta, Ua: O.La.Ua, lookup: O.La.lookup, ib: O.La.ib, rename: O.La.rename, unlink: O.La.unlink, rmdir: O.La.rmdir, readdir: O.La.readdir, symlink: O.La.symlink }, stream: { Va: O.Ma.Va } }, file: { node: { Ta: O.La.Ta, Ua: O.La.Ua }, stream: { Va: O.Ma.Va, read: O.Ma.read, write: O.Ma.write, jb: O.Ma.jb, kb: O.Ma.kb } }, link: { node: { Ta: O.La.Ta, Ua: O.La.Ua, readlink: O.La.readlink }, stream: {} }, yb: { node: { Ta: O.La.Ta, Ua: O.La.Ua }, stream: yb } });
          c = zb(a, b, c, d);
          P(c.mode) ? (c.La = O.Wa.dir.node, c.Ma = O.Wa.dir.stream, c.Na = {}) : 32768 === (c.mode & 61440) ? (c.La = O.Wa.file.node, c.Ma = O.Wa.file.stream, c.Ra = 0, c.Na = null) : 40960 === (c.mode & 61440) ? (c.La = O.Wa.link.node, c.Ma = O.Wa.link.stream) : 8192 === (c.mode & 61440) && (c.La = O.Wa.yb.node, c.Ma = O.Wa.yb.stream);
          c.atime = c.mtime = c.ctime = Date.now();
          a && (a.Na[b] = c, a.atime = a.mtime = a.ctime = c.atime);
          return c;
        }, fc(a) {
          return a.Na ? a.Na.subarray ? a.Na.subarray(0, a.Ra) : new Uint8Array(a.Na) : new Uint8Array(0);
        }, La: {
          Ta(a) {
            var b = {};
            b.dev = 8192 === (a.mode & 61440) ? a.id : 1;
            b.ino = a.id;
            b.mode = a.mode;
            b.nlink = 1;
            b.uid = 0;
            b.gid = 0;
            b.rdev = a.rdev;
            P(a.mode) ? b.size = 4096 : 32768 === (a.mode & 61440) ? b.size = a.Ra : 40960 === (a.mode & 61440) ? b.size = a.link.length : b.size = 0;
            b.atime = new Date(a.atime);
            b.mtime = new Date(a.mtime);
            b.ctime = new Date(a.ctime);
            b.blksize = 4096;
            b.blocks = Math.ceil(b.size / b.blksize);
            return b;
          },
          Ua(a, b) {
            for (var c of ["mode", "atime", "mtime", "ctime"]) null != b[c] && (a[c] = b[c]);
            void 0 !== b.size && (b = b.size, a.Ra != b && (0 == b ? (a.Na = null, a.Ra = 0) : (c = a.Na, a.Na = new Uint8Array(b), c && a.Na.set(c.subarray(0, Math.min(b, a.Ra))), a.Ra = b)));
          },
          lookup() {
            O.nb || (O.nb = new N(44), O.nb.stack = "<generic error, no stack>");
            throw O.nb;
          },
          ib(a, b, c, d) {
            return O.createNode(a, b, c, d);
          },
          rename(a, b, c) {
            try {
              var d = Q(b, c);
            } catch (g) {
            }
            if (d) {
              if (P(a.mode)) for (var e in d.Na) throw new N(55);
              Ab(d);
            }
            delete a.parent.Na[a.name];
            b.Na[c] = a;
            a.name = c;
            b.ctime = b.mtime = a.parent.ctime = a.parent.mtime = Date.now();
          },
          unlink(a, b) {
            delete a.Na[b];
            a.ctime = a.mtime = Date.now();
          },
          rmdir(a, b) {
            var c = Q(a, b), d;
            for (d in c.Na) throw new N(55);
            delete a.Na[b];
            a.ctime = a.mtime = Date.now();
          },
          readdir(a) {
            return [".", "..", ...Object.keys(a.Na)];
          },
          symlink(a, b, c) {
            a = O.createNode(a, b, 41471, 0);
            a.link = c;
            return a;
          },
          readlink(a) {
            if (40960 !== (a.mode & 61440)) throw new N(28);
            return a.link;
          }
        }, Ma: { read(a, b, c, d, e) {
          var g = a.node.Na;
          if (e >= a.node.Ra) return 0;
          a = Math.min(a.node.Ra - e, d);
          if (8 < a && g.subarray) b.set(g.subarray(e, e + a), c);
          else for (d = 0; d < a; d++) b[c + d] = g[e + d];
          return a;
        }, write(a, b, c, d, e, g) {
          b.buffer === m.buffer && (g = false);
          if (!d) return 0;
          a = a.node;
          a.mtime = a.ctime = Date.now();
          if (b.subarray && (!a.Na || a.Na.subarray)) {
            if (g) return a.Na = b.subarray(c, c + d), a.Ra = d;
            if (0 === a.Ra && 0 === e) return a.Na = b.slice(c, c + d), a.Ra = d;
            if (e + d <= a.Ra) return a.Na.set(b.subarray(c, c + d), e), d;
          }
          g = e + d;
          var h = a.Na ? a.Na.length : 0;
          h >= g || (g = Math.max(g, h * (1048576 > h ? 2 : 1.125) >>> 0), 0 != h && (g = Math.max(g, 256)), h = a.Na, a.Na = new Uint8Array(g), 0 < a.Ra && a.Na.set(h.subarray(0, a.Ra), 0));
          if (a.Na.subarray && b.subarray) a.Na.set(b.subarray(c, c + d), e);
          else for (g = 0; g < d; g++) a.Na[e + g] = b[c + g];
          a.Ra = Math.max(a.Ra, e + d);
          return d;
        }, Va(a, b, c) {
          1 === c ? b += a.position : 2 === c && 32768 === (a.node.mode & 61440) && (b += a.node.Ra);
          if (0 > b) throw new N(28);
          return b;
        }, jb(a, b, c, d, e) {
          if (32768 !== (a.node.mode & 61440)) throw new N(43);
          a = a.node.Na;
          if (e & 2 || !a || a.buffer !== m.buffer) {
            e = true;
            d = 65536 * Math.ceil(b / 65536);
            var g = Bb(65536, d);
            g && C.fill(0, g, g + d);
            d = g;
            if (!d) throw new N(48);
            if (a) {
              if (0 < c || c + b < a.length) a.subarray ? a = a.subarray(c, c + b) : a = Array.prototype.slice.call(a, c, c + b);
              m.set(a, d);
            }
          } else e = false, d = a.byteOffset;
          return { Xb: d, Eb: e };
        }, kb(a, b, c, d) {
          O.Ma.write(a, b, 0, d, c, false);
          return 0;
        } } }, ja = (a, b) => {
          var c = 0;
          a && (c |= 365);
          b && (c |= 146);
          return c;
        }, Cb = null, Db = {}, Eb = [], Fb = 1, R = null, Gb = false, Hb = true, N = class {
          name = "ErrnoError";
          constructor(a) {
            this.Pa = a;
          }
        }, Ib = class {
          hb = {};
          node = null;
          get flags() {
            return this.hb.flags;
          }
          set flags(a) {
            this.hb.flags = a;
          }
          get position() {
            return this.hb.position;
          }
          set position(a) {
            this.hb.position = a;
          }
        }, Jb = class {
          La = {};
          Ma = {};
          bb = null;
          constructor(a, b, c, d) {
            a ||= this;
            this.parent = a;
            this.Xa = a.Xa;
            this.id = Fb++;
            this.name = b;
            this.mode = c;
            this.rdev = d;
            this.atime = this.mtime = this.ctime = Date.now();
          }
          get read() {
            return 365 === (this.mode & 365);
          }
          set read(a) {
            a ? this.mode |= 365 : this.mode &= -366;
          }
          get write() {
            return 146 === (this.mode & 146);
          }
          set write(a) {
            a ? this.mode |= 146 : this.mode &= -147;
          }
        };
        function S(a, b = {}) {
          if (!a) throw new N(44);
          b.pb ?? (b.pb = true);
          "/" === a.charAt(0) || (a = "//" + a);
          var c = 0;
          a: for (; 40 > c; c++) {
            a = a.split("/").filter((q) => !!q);
            for (var d = Cb, e = "/", g = 0; g < a.length; g++) {
              var h = g === a.length - 1;
              if (h && b.parent) break;
              if ("." !== a[g]) if (".." === a[g]) if (e = bb(e), d === d.parent) {
                a = e + "/" + a.slice(g + 1).join("/");
                c--;
                continue a;
              } else d = d.parent;
              else {
                e = ia(e + "/" + a[g]);
                try {
                  d = Q(d, a[g]);
                } catch (q) {
                  if (44 === q?.Pa && h && b.Wb) return { path: e };
                  throw q;
                }
                !d.bb || h && !b.pb || (d = d.bb.root);
                if (40960 === (d.mode & 61440) && (!h || b.ab)) {
                  if (!d.La.readlink) throw new N(52);
                  d = d.La.readlink(d);
                  "/" === d.charAt(0) || (d = bb(e) + "/" + d);
                  a = d + "/" + a.slice(g + 1).join("/");
                  continue a;
                }
              }
            }
            return { path: e, node: d };
          }
          throw new N(32);
        }
        function ha(a) {
          for (var b; ; ) {
            if (a === a.parent) return a = a.Xa.Db, b ? "/" !== a[a.length - 1] ? `${a}/${b}` : a + b : a;
            b = b ? `${a.name}/${b}` : a.name;
            a = a.parent;
          }
        }
        function Kb(a, b) {
          for (var c = 0, d = 0; d < b.length; d++) c = (c << 5) - c + b.charCodeAt(d) | 0;
          return (a + c >>> 0) % R.length;
        }
        function Ab(a) {
          var b = Kb(a.parent.id, a.name);
          if (R[b] === a) R[b] = a.cb;
          else for (b = R[b]; b; ) {
            if (b.cb === a) {
              b.cb = a.cb;
              break;
            }
            b = b.cb;
          }
        }
        function Q(a, b) {
          var c = P(a.mode) ? (c = Lb(a, "x")) ? c : a.La.lookup ? 0 : 2 : 54;
          if (c) throw new N(c);
          for (c = R[Kb(a.id, b)]; c; c = c.cb) {
            var d = c.name;
            if (c.parent.id === a.id && d === b) return c;
          }
          return a.La.lookup(a, b);
        }
        function zb(a, b, c, d) {
          a = new Jb(a, b, c, d);
          b = Kb(a.parent.id, a.name);
          a.cb = R[b];
          return R[b] = a;
        }
        function P(a) {
          return 16384 === (a & 61440);
        }
        function Lb(a, b) {
          return Hb ? 0 : b.includes("r") && !(a.mode & 292) || b.includes("w") && !(a.mode & 146) || b.includes("x") && !(a.mode & 73) ? 2 : 0;
        }
        function Mb(a, b) {
          if (!P(a.mode)) return 54;
          try {
            return Q(a, b), 20;
          } catch (c) {
          }
          return Lb(a, "wx");
        }
        function Nb(a, b, c) {
          try {
            var d = Q(a, b);
          } catch (e) {
            return e.Pa;
          }
          if (a = Lb(a, "wx")) return a;
          if (c) {
            if (!P(d.mode)) return 54;
            if (d === d.parent || "/" === ha(d)) return 10;
          } else if (P(d.mode)) return 31;
          return 0;
        }
        function Ob(a) {
          if (!a) throw new N(63);
          return a;
        }
        function T(a) {
          a = Eb[a];
          if (!a) throw new N(8);
          return a;
        }
        function Pb(a, b = -1) {
          a = Object.assign(new Ib(), a);
          if (-1 == b) a: {
            for (b = 0; 4096 >= b; b++) if (!Eb[b]) break a;
            throw new N(33);
          }
          a.fd = b;
          return Eb[b] = a;
        }
        function Qb(a, b = -1) {
          a = Pb(a, b);
          a.Ma?.ec?.(a);
          return a;
        }
        function Rb(a, b, c) {
          var d = a?.Ma.Ua;
          a = d ? a : b;
          d ??= b.La.Ua;
          Ob(d);
          d(a, c);
        }
        var yb = { open(a) {
          a.Ma = Db[a.node.rdev].Ma;
          a.Ma.open?.(a);
        }, Va() {
          throw new N(70);
        } };
        function mb(a, b) {
          Db[a] = { Ma: b };
        }
        function Sb(a, b) {
          var c = "/" === b;
          if (c && Cb) throw new N(10);
          if (!c && b) {
            var d = S(b, { pb: false });
            b = d.path;
            d = d.node;
            if (d.bb) throw new N(10);
            if (!P(d.mode)) throw new N(54);
          }
          b = { type: a, kc: {}, Db: b, Vb: [] };
          a = a.Xa(b);
          a.Xa = b;
          b.root = a;
          c ? Cb = a : d && (d.bb = b, d.Xa && d.Xa.Vb.push(b));
        }
        function Tb(a, b, c) {
          var d = S(a, { parent: true }).node;
          a = cb(a);
          if (!a) throw new N(28);
          if ("." === a || ".." === a) throw new N(20);
          var e = Mb(d, a);
          if (e) throw new N(e);
          if (!d.La.ib) throw new N(63);
          return d.La.ib(d, a, b, c);
        }
        function ka(a, b = 438) {
          return Tb(a, b & 4095 | 32768, 0);
        }
        function U(a, b = 511) {
          return Tb(a, b & 1023 | 16384, 0);
        }
        function Ub(a, b, c) {
          "undefined" == typeof c && (c = b, b = 438);
          Tb(a, b | 8192, c);
        }
        function Vb(a, b) {
          if (!fb(a)) throw new N(44);
          var c = S(b, { parent: true }).node;
          if (!c) throw new N(44);
          b = cb(b);
          var d = Mb(c, b);
          if (d) throw new N(d);
          if (!c.La.symlink) throw new N(63);
          c.La.symlink(c, b, a);
        }
        function Wb(a) {
          var b = S(a, { parent: true }).node;
          a = cb(a);
          var c = Q(b, a), d = Nb(b, a, true);
          if (d) throw new N(d);
          if (!b.La.rmdir) throw new N(63);
          if (c.bb) throw new N(10);
          b.La.rmdir(b, a);
          Ab(c);
        }
        function ua(a) {
          var b = S(a, { parent: true }).node;
          if (!b) throw new N(44);
          a = cb(a);
          var c = Q(b, a), d = Nb(b, a, false);
          if (d) throw new N(d);
          if (!b.La.unlink) throw new N(63);
          if (c.bb) throw new N(10);
          b.La.unlink(b, a);
          Ab(c);
        }
        function Xb(a, b) {
          a = S(a, { ab: !b }).node;
          return Ob(a.La.Ta)(a);
        }
        function Yb(a, b, c, d) {
          Rb(a, b, { mode: c & 4095 | b.mode & -4096, ctime: Date.now(), Lb: d });
        }
        function la(a, b) {
          a = "string" == typeof a ? S(a, { ab: true }).node : a;
          Yb(null, a, b);
        }
        function Zb(a, b, c) {
          if (P(b.mode)) throw new N(31);
          if (32768 !== (b.mode & 61440)) throw new N(28);
          var d = Lb(b, "w");
          if (d) throw new N(d);
          Rb(a, b, { size: c, timestamp: Date.now() });
        }
        function ma(a, b, c = 438) {
          if ("" === a) throw new N(44);
          if ("string" == typeof b) {
            var d = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }[b];
            if ("undefined" == typeof d) throw Error(`Unknown file open mode: ${b}`);
            b = d;
          }
          c = b & 64 ? c & 4095 | 32768 : 0;
          if ("object" == typeof a) d = a;
          else {
            var e = a.endsWith("/");
            var g = S(a, { ab: !(b & 131072), Wb: true });
            d = g.node;
            a = g.path;
          }
          g = false;
          if (b & 64) if (d) {
            if (b & 128) throw new N(20);
          } else {
            if (e) throw new N(31);
            d = Tb(a, c | 511, 0);
            g = true;
          }
          if (!d) throw new N(44);
          8192 === (d.mode & 61440) && (b &= -513);
          if (b & 65536 && !P(d.mode)) throw new N(54);
          if (!g && (d ? 40960 === (d.mode & 61440) ? e = 32 : (e = ["r", "w", "rw"][b & 3], b & 512 && (e += "w"), e = P(d.mode) && ("r" !== e || b & 576) ? 31 : Lb(d, e)) : e = 44, e)) throw new N(e);
          b & 512 && !g && (e = d, e = "string" == typeof e ? S(e, { ab: true }).node : e, Zb(null, e, 0));
          b = Pb({ node: d, path: ha(d), flags: b & -131713, seekable: true, position: 0, Ma: d.Ma, Yb: [], error: false });
          b.Ma.open && b.Ma.open(b);
          g && la(d, c & 511);
          return b;
        }
        function oa(a) {
          if (null === a.fd) throw new N(8);
          a.rb && (a.rb = null);
          try {
            a.Ma.close && a.Ma.close(a);
          } catch (b) {
            throw b;
          } finally {
            Eb[a.fd] = null;
          }
          a.fd = null;
        }
        function $b(a, b, c) {
          if (null === a.fd) throw new N(8);
          if (!a.seekable || !a.Ma.Va) throw new N(70);
          if (0 != c && 1 != c && 2 != c) throw new N(28);
          a.position = a.Ma.Va(a, b, c);
          a.Yb = [];
        }
        function ac(a, b, c, d, e) {
          if (0 > d || 0 > e) throw new N(28);
          if (null === a.fd) throw new N(8);
          if (1 === (a.flags & 2097155)) throw new N(8);
          if (P(a.node.mode)) throw new N(31);
          if (!a.Ma.read) throw new N(28);
          var g = "undefined" != typeof e;
          if (!g) e = a.position;
          else if (!a.seekable) throw new N(70);
          b = a.Ma.read(a, b, c, d, e);
          g || (a.position += b);
          return b;
        }
        function na(a, b, c, d, e) {
          if (0 > d || 0 > e) throw new N(28);
          if (null === a.fd) throw new N(8);
          if (0 === (a.flags & 2097155)) throw new N(8);
          if (P(a.node.mode)) throw new N(31);
          if (!a.Ma.write) throw new N(28);
          a.seekable && a.flags & 1024 && $b(a, 0, 2);
          var g = "undefined" != typeof e;
          if (!g) e = a.position;
          else if (!a.seekable) throw new N(70);
          b = a.Ma.write(a, b, c, d, e, void 0);
          g || (a.position += b);
          return b;
        }
        function ta(a) {
          var b = b || 0;
          var c = "binary";
          "utf8" !== c && "binary" !== c && Ma(`Invalid encoding type "${c}"`);
          b = ma(a, b);
          a = Xb(a).size;
          var d = new Uint8Array(a);
          ac(b, d, 0, a, 0);
          "utf8" === c && (d = gb(d));
          oa(b);
          return d;
        }
        function W(a, b, c) {
          a = ia("/dev/" + a);
          var d = ja(!!b, !!c);
          W.Cb ?? (W.Cb = 64);
          var e = W.Cb++ << 8 | 0;
          mb(e, { open(g) {
            g.seekable = false;
          }, close() {
            c?.buffer?.length && c(10);
          }, read(g, h, q, w) {
            for (var t = 0, x = 0; x < w; x++) {
              try {
                var D = b();
              } catch (pb) {
                throw new N(29);
              }
              if (void 0 === D && 0 === t) throw new N(6);
              if (null === D || void 0 === D) break;
              t++;
              h[q + x] = D;
            }
            t && (g.node.atime = Date.now());
            return t;
          }, write(g, h, q, w) {
            for (var t = 0; t < w; t++) try {
              c(h[q + t]);
            } catch (x) {
              throw new N(29);
            }
            w && (g.node.mtime = g.node.ctime = Date.now());
            return t;
          } });
          Ub(a, d, e);
        }
        var X = {};
        function Y(a, b, c) {
          if ("/" === b.charAt(0)) return b;
          a = -100 === a ? "/" : T(a).path;
          if (0 == b.length) {
            if (!c) throw new N(44);
            return a;
          }
          return a + "/" + b;
        }
        function kc(a, b) {
          F[a >> 2] = b.dev;
          F[a + 4 >> 2] = b.mode;
          F[a + 8 >> 2] = b.nlink;
          F[a + 12 >> 2] = b.uid;
          F[a + 16 >> 2] = b.gid;
          F[a + 20 >> 2] = b.rdev;
          G[a + 24 >> 3] = BigInt(b.size);
          E[a + 32 >> 2] = 4096;
          E[a + 36 >> 2] = b.blocks;
          var c = b.atime.getTime(), d = b.mtime.getTime(), e = b.ctime.getTime();
          G[a + 40 >> 3] = BigInt(Math.floor(c / 1e3));
          F[a + 48 >> 2] = c % 1e3 * 1e6;
          G[a + 56 >> 3] = BigInt(Math.floor(d / 1e3));
          F[a + 64 >> 2] = d % 1e3 * 1e6;
          G[a + 72 >> 3] = BigInt(Math.floor(e / 1e3));
          F[a + 80 >> 2] = e % 1e3 * 1e6;
          G[a + 88 >> 3] = BigInt(b.ino);
          return 0;
        }
        var Cc = void 0, Ec = () => {
          var a = E[+Cc >> 2];
          Cc += 4;
          return a;
        }, Fc = 0, Gc = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Hc = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], Ic = {}, Jc = (a) => {
          Ga = a;
          Ya || 0 < Fc || (k.onExit?.(a), Fa = true);
          xa(a, new Sa(a));
        }, Kc = (a) => {
          if (!Fa) try {
            a();
          } catch (b) {
            b instanceof Sa || "unwind" == b || xa(1, b);
          } finally {
            if (!(Ya || 0 < Fc)) try {
              Ga = a = Ga, Jc(a);
            } catch (b) {
              b instanceof Sa || "unwind" == b || xa(1, b);
            }
          }
        }, Lc = {}, Nc = () => {
          if (!Mc) {
            var a = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8", _: wa || "./this.program" }, b;
            for (b in Lc) void 0 === Lc[b] ? delete a[b] : a[b] = Lc[b];
            var c = [];
            for (b in a) c.push(`${b}=${a[b]}`);
            Mc = c;
          }
          return Mc;
        }, Mc, Oc = (a, b, c, d) => {
          var e = { string: (t) => {
            var x = 0;
            if (null !== t && void 0 !== t && 0 !== t) {
              x = ib(t) + 1;
              var D = y(x);
              M(t, C, D, x);
              x = D;
            }
            return x;
          }, array: (t) => {
            var x = y(t.length);
            m.set(t, x);
            return x;
          } };
          a = k["_" + a];
          var g = [], h = 0;
          if (d) for (var q = 0; q < d.length; q++) {
            var w = e[c[q]];
            w ? (0 === h && (h = pa()), g[q] = w(d[q])) : g[q] = d[q];
          }
          c = a(...g);
          return c = (function(t) {
            0 !== h && ra(h);
            return "string" === b ? z(t) : "boolean" === b ? !!t : t;
          })(c);
        }, fa = (a) => {
          var b = ib(a) + 1, c = da(b);
          c && M(a, C, c, b);
          return c;
        }, Pc, Qc = [], A = (a) => {
          Pc.delete(Z.get(a));
          Z.set(a, null);
          Qc.push(a);
        }, Rc = (a) => {
          const b = a.length;
          return [b % 128 | 128, b >> 7, ...a];
        }, Sc = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 }, Tc = (a) => Rc(Array.from(a, (b) => Sc[b])), va = (a, b) => {
          if (!Pc) {
            Pc = /* @__PURE__ */ new WeakMap();
            var c = Z.length;
            if (Pc) for (var d = 0; d < 0 + c; d++) {
              var e = Z.get(d);
              e && Pc.set(e, d);
            }
          }
          if (c = Pc.get(a) || 0) return c;
          c = Qc.length ? Qc.pop() : Z.grow(1);
          try {
            Z.set(c, a);
          } catch (g) {
            if (!(g instanceof TypeError)) throw g;
            b = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, ...Rc([1, 96, ...Tc(b.slice(1)), ...Tc("v" === b[0] ? "" : b[0])]), 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
            b = new WebAssembly.Module(b);
            b = new WebAssembly.Instance(b, { e: { f: a } }).exports.f;
            Z.set(c, b);
          }
          Pc.set(a, c);
          return c;
        };
        R = Array(4096);
        Sb(O, "/");
        U("/tmp");
        U("/home");
        U("/home/web_user");
        (function() {
          U("/dev");
          mb(259, { read: () => 0, write: (d, e, g, h) => h, Va: () => 0 });
          Ub("/dev/null", 259);
          kb(1280, wb);
          kb(1536, xb);
          Ub("/dev/tty", 1280);
          Ub("/dev/tty1", 1536);
          var a = new Uint8Array(1024), b = 0, c = () => {
            0 === b && (eb(a), b = a.byteLength);
            return a[--b];
          };
          W("random", c);
          W("urandom", c);
          U("/dev/shm");
          U("/dev/shm/tmp");
        })();
        (function() {
          U("/proc");
          var a = U("/proc/self");
          U("/proc/self/fd");
          Sb({ Xa() {
            var b = zb(a, "fd", 16895, 73);
            b.Ma = { Va: O.Ma.Va };
            b.La = { lookup(c, d) {
              c = +d;
              var e = T(c);
              c = { parent: null, Xa: { Db: "fake" }, La: { readlink: () => e.path }, id: c + 1 };
              return c.parent = c;
            }, readdir() {
              return Array.from(Eb.entries()).filter(([, c]) => c).map(([c]) => c.toString());
            } };
            return b;
          } }, "/proc/self/fd");
        })();
        k.noExitRuntime && (Ya = k.noExitRuntime);
        k.print && (Da = k.print);
        k.printErr && (B = k.printErr);
        k.wasmBinary && (Ea = k.wasmBinary);
        k.thisProgram && (wa = k.thisProgram);
        if (k.preInit) for ("function" == typeof k.preInit && (k.preInit = [k.preInit]); 0 < k.preInit.length; ) k.preInit.shift()();
        k.stackSave = () => pa();
        k.stackRestore = (a) => ra(a);
        k.stackAlloc = (a) => y(a);
        k.cwrap = (a, b, c, d) => {
          var e = !c || c.every((g) => "number" === g || "boolean" === g);
          return "string" !== b && e && !d ? k["_" + a] : (...g) => Oc(a, b, c, g);
        };
        k.addFunction = va;
        k.removeFunction = A;
        k.UTF8ToString = z;
        k.stringToNewUTF8 = fa;
        k.writeArrayToMemory = (a, b) => {
          m.set(a, b);
        };
        var da, ea, Bb, Uc, ra, y, pa, La, Z, Vc = {
          a: (a, b, c, d) => Ma(`Assertion failed: ${z(a)}, at: ` + [b ? z(b) : "unknown filename", c, d ? z(d) : "unknown function"]),
          i: function(a, b) {
            try {
              return a = z(a), la(a, b), 0;
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return -c.Pa;
            }
          },
          L: function(a, b, c) {
            try {
              b = z(b);
              b = Y(a, b);
              if (c & -8) return -28;
              var d = S(b, { ab: true }).node;
              if (!d) return -44;
              a = "";
              c & 4 && (a += "r");
              c & 2 && (a += "w");
              c & 1 && (a += "x");
              return a && Lb(d, a) ? -2 : 0;
            } catch (e) {
              if ("undefined" == typeof X || "ErrnoError" !== e.name) throw e;
              return -e.Pa;
            }
          },
          j: function(a, b) {
            try {
              var c = T(a);
              Yb(c, c.node, b, false);
              return 0;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return -d.Pa;
            }
          },
          h: function(a) {
            try {
              var b = T(a);
              Rb(b, b.node, { timestamp: Date.now(), Lb: false });
              return 0;
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return -c.Pa;
            }
          },
          b: function(a, b, c) {
            Cc = c;
            try {
              var d = T(a);
              switch (b) {
                case 0:
                  var e = Ec();
                  if (0 > e) break;
                  for (; Eb[e]; ) e++;
                  return Qb(d, e).fd;
                case 1:
                case 2:
                  return 0;
                case 3:
                  return d.flags;
                case 4:
                  return e = Ec(), d.flags |= e, 0;
                case 12:
                  return e = Ec(), Ha[e + 0 >> 1] = 2, 0;
                case 13:
                case 14:
                  return 0;
              }
              return -28;
            } catch (g) {
              if ("undefined" == typeof X || "ErrnoError" !== g.name) throw g;
              return -g.Pa;
            }
          },
          g: function(a, b) {
            try {
              var c = T(a), d = c.node, e = c.Ma.Ta;
              a = e ? c : d;
              e ??= d.La.Ta;
              Ob(e);
              var g = e(a);
              return kc(b, g);
            } catch (h) {
              if ("undefined" == typeof X || "ErrnoError" !== h.name) throw h;
              return -h.Pa;
            }
          },
          H: function(a, b) {
            b = -9007199254740992 > b || 9007199254740992 < b ? NaN : Number(b);
            try {
              if (isNaN(b)) return -61;
              var c = T(a);
              if (0 > b || 0 === (c.flags & 2097155)) throw new N(28);
              Zb(c, c.node, b);
              return 0;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return -d.Pa;
            }
          },
          G: function(a, b) {
            try {
              if (0 === b) return -28;
              var c = ib("/") + 1;
              if (b < c) return -68;
              M("/", C, a, b);
              return c;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return -d.Pa;
            }
          },
          K: function(a, b) {
            try {
              return a = z(a), kc(b, Xb(a, true));
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return -c.Pa;
            }
          },
          C: function(a, b, c) {
            try {
              return b = z(b), b = Y(a, b), U(b, c), 0;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return -d.Pa;
            }
          },
          J: function(a, b, c, d) {
            try {
              b = z(b);
              var e = d & 256;
              b = Y(a, b, d & 4096);
              return kc(c, e ? Xb(b, true) : Xb(b));
            } catch (g) {
              if ("undefined" == typeof X || "ErrnoError" !== g.name) throw g;
              return -g.Pa;
            }
          },
          x: function(a, b, c, d) {
            Cc = d;
            try {
              b = z(b);
              b = Y(a, b);
              var e = d ? Ec() : 0;
              return ma(b, c, e).fd;
            } catch (g) {
              if ("undefined" == typeof X || "ErrnoError" !== g.name) throw g;
              return -g.Pa;
            }
          },
          v: function(a, b, c, d) {
            try {
              b = z(b);
              b = Y(a, b);
              if (0 >= d) return -28;
              var e = S(b).node;
              if (!e) throw new N(44);
              if (!e.La.readlink) throw new N(28);
              var g = e.La.readlink(e);
              var h = Math.min(d, ib(g)), q = m[c + h];
              M(
                g,
                C,
                c,
                d + 1
              );
              m[c + h] = q;
              return h;
            } catch (w) {
              if ("undefined" == typeof X || "ErrnoError" !== w.name) throw w;
              return -w.Pa;
            }
          },
          u: function(a) {
            try {
              return a = z(a), Wb(a), 0;
            } catch (b) {
              if ("undefined" == typeof X || "ErrnoError" !== b.name) throw b;
              return -b.Pa;
            }
          },
          f: function(a, b) {
            try {
              return a = z(a), kc(b, Xb(a));
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return -c.Pa;
            }
          },
          r: function(a, b, c) {
            try {
              b = z(b);
              b = Y(a, b);
              if (c) if (512 === c) Wb(b);
              else return -28;
              else ua(b);
              return 0;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return -d.Pa;
            }
          },
          q: function(a, b, c) {
            try {
              b = z(b);
              b = Y(a, b, true);
              var d = Date.now(), e, g;
              if (c) {
                var h = F[c >> 2] + 4294967296 * E[c + 4 >> 2], q = E[c + 8 >> 2];
                1073741823 == q ? e = d : 1073741822 == q ? e = null : e = 1e3 * h + q / 1e6;
                c += 16;
                h = F[c >> 2] + 4294967296 * E[c + 4 >> 2];
                q = E[c + 8 >> 2];
                1073741823 == q ? g = d : 1073741822 == q ? g = null : g = 1e3 * h + q / 1e6;
              } else g = e = d;
              if (null !== (g ?? e)) {
                a = e;
                var w = S(b, { ab: true }).node;
                Ob(w.La.Ua)(w, { atime: a, mtime: g });
              }
              return 0;
            } catch (t) {
              if ("undefined" == typeof X || "ErrnoError" !== t.name) throw t;
              return -t.Pa;
            }
          },
          m: () => Ma(""),
          l: () => {
            Ya = false;
            Fc = 0;
          },
          A: function(a, b) {
            a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a);
            a = new Date(1e3 * a);
            E[b >> 2] = a.getSeconds();
            E[b + 4 >> 2] = a.getMinutes();
            E[b + 8 >> 2] = a.getHours();
            E[b + 12 >> 2] = a.getDate();
            E[b + 16 >> 2] = a.getMonth();
            E[b + 20 >> 2] = a.getFullYear() - 1900;
            E[b + 24 >> 2] = a.getDay();
            var c = a.getFullYear();
            E[b + 28 >> 2] = (0 !== c % 4 || 0 === c % 100 && 0 !== c % 400 ? Hc : Gc)[a.getMonth()] + a.getDate() - 1 | 0;
            E[b + 36 >> 2] = -(60 * a.getTimezoneOffset());
            c = new Date(a.getFullYear(), 6, 1).getTimezoneOffset();
            var d = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
            E[b + 32 >> 2] = (c != d && a.getTimezoneOffset() == Math.min(d, c)) | 0;
          },
          y: function(a, b, c, d, e, g, h) {
            e = -9007199254740992 > e || 9007199254740992 < e ? NaN : Number(e);
            try {
              var q = T(d);
              if (0 !== (b & 2) && 0 === (c & 2) && 2 !== (q.flags & 2097155)) throw new N(2);
              if (1 === (q.flags & 2097155)) throw new N(2);
              if (!q.Ma.jb) throw new N(43);
              if (!a) throw new N(28);
              var w = q.Ma.jb(q, a, e, b, c);
              var t = w.Xb;
              E[g >> 2] = w.Eb;
              F[h >> 2] = t;
              return 0;
            } catch (x) {
              if ("undefined" == typeof X || "ErrnoError" !== x.name) throw x;
              return -x.Pa;
            }
          },
          z: function(a, b, c, d, e, g) {
            g = -9007199254740992 > g || 9007199254740992 < g ? NaN : Number(g);
            try {
              var h = T(e);
              if (c & 2) {
                c = g;
                if (32768 !== (h.node.mode & 61440)) throw new N(43);
                if (!(d & 2)) {
                  var q = C.slice(a, a + b);
                  h.Ma.kb && h.Ma.kb(h, q, c, b, d);
                }
              }
            } catch (w) {
              if ("undefined" == typeof X || "ErrnoError" !== w.name) throw w;
              return -w.Pa;
            }
          },
          n: (a, b) => {
            Ic[a] && (clearTimeout(Ic[a].id), delete Ic[a]);
            if (!b) return 0;
            var c = setTimeout(() => {
              delete Ic[a];
              Kc(() => Uc(a, performance.now()));
            }, b);
            Ic[a] = { id: c, lc: b };
            return 0;
          },
          B: (a, b, c, d) => {
            var e = (/* @__PURE__ */ new Date()).getFullYear(), g = new Date(e, 0, 1).getTimezoneOffset();
            e = new Date(e, 6, 1).getTimezoneOffset();
            F[a >> 2] = 60 * Math.max(g, e);
            E[b >> 2] = Number(g != e);
            b = (h) => {
              var q = Math.abs(h);
              return `UTC${0 <= h ? "-" : "+"}${String(Math.floor(q / 60)).padStart(2, "0")}${String(q % 60).padStart(2, "0")}`;
            };
            a = b(g);
            b = b(e);
            e < g ? (M(a, C, c, 17), M(b, C, d, 17)) : (M(a, C, d, 17), M(b, C, c, 17));
          },
          d: () => Date.now(),
          s: () => 2147483648,
          c: () => performance.now(),
          o: (a) => {
            var b = C.length;
            a >>>= 0;
            if (2147483648 < a) return false;
            for (var c = 1; 4 >= c; c *= 2) {
              var d = b * (1 + 0.2 / c);
              d = Math.min(d, a + 100663296);
              a: {
                d = (Math.min(2147483648, 65536 * Math.ceil(Math.max(
                  a,
                  d
                ) / 65536)) - La.buffer.byteLength + 65535) / 65536 | 0;
                try {
                  La.grow(d);
                  Ka();
                  var e = 1;
                  break a;
                } catch (g) {
                }
                e = void 0;
              }
              if (e) return true;
            }
            return false;
          },
          E: (a, b) => {
            var c = 0, d = 0, e;
            for (e of Nc()) {
              var g = b + c;
              F[a + d >> 2] = g;
              c += M(e, C, g, Infinity) + 1;
              d += 4;
            }
            return 0;
          },
          F: (a, b) => {
            var c = Nc();
            F[a >> 2] = c.length;
            a = 0;
            for (var d of c) a += ib(d) + 1;
            F[b >> 2] = a;
            return 0;
          },
          e: function(a) {
            try {
              var b = T(a);
              oa(b);
              return 0;
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return c.Pa;
            }
          },
          p: function(a, b) {
            try {
              var c = T(a);
              m[b] = c.tty ? 2 : P(c.mode) ? 3 : 40960 === (c.mode & 61440) ? 7 : 4;
              Ha[b + 2 >> 1] = 0;
              G[b + 8 >> 3] = BigInt(0);
              G[b + 16 >> 3] = BigInt(0);
              return 0;
            } catch (d) {
              if ("undefined" == typeof X || "ErrnoError" !== d.name) throw d;
              return d.Pa;
            }
          },
          w: function(a, b, c, d) {
            try {
              a: {
                var e = T(a);
                a = b;
                for (var g, h = b = 0; h < c; h++) {
                  var q = F[a >> 2], w = F[a + 4 >> 2];
                  a += 8;
                  var t = ac(e, m, q, w, g);
                  if (0 > t) {
                    var x = -1;
                    break a;
                  }
                  b += t;
                  if (t < w) break;
                  "undefined" != typeof g && (g += t);
                }
                x = b;
              }
              F[d >> 2] = x;
              return 0;
            } catch (D) {
              if ("undefined" == typeof X || "ErrnoError" !== D.name) throw D;
              return D.Pa;
            }
          },
          D: function(a, b, c, d) {
            b = -9007199254740992 > b || 9007199254740992 < b ? NaN : Number(b);
            try {
              if (isNaN(b)) return 61;
              var e = T(a);
              $b(e, b, c);
              G[d >> 3] = BigInt(e.position);
              e.rb && 0 === b && 0 === c && (e.rb = null);
              return 0;
            } catch (g) {
              if ("undefined" == typeof X || "ErrnoError" !== g.name) throw g;
              return g.Pa;
            }
          },
          I: function(a) {
            try {
              var b = T(a);
              return b.Ma?.fsync?.(b);
            } catch (c) {
              if ("undefined" == typeof X || "ErrnoError" !== c.name) throw c;
              return c.Pa;
            }
          },
          t: function(a, b, c, d) {
            try {
              a: {
                var e = T(a);
                a = b;
                for (var g, h = b = 0; h < c; h++) {
                  var q = F[a >> 2], w = F[a + 4 >> 2];
                  a += 8;
                  var t = na(e, m, q, w, g);
                  if (0 > t) {
                    var x = -1;
                    break a;
                  }
                  b += t;
                  if (t < w) break;
                  "undefined" != typeof g && (g += t);
                }
                x = b;
              }
              F[d >> 2] = x;
              return 0;
            } catch (D) {
              if ("undefined" == typeof X || "ErrnoError" !== D.name) throw D;
              return D.Pa;
            }
          },
          k: Jc
        };
        function Wc() {
          function a() {
            k.calledRun = true;
            if (!Fa) {
              if (!k.noFSInit && !Gb) {
                var b, c;
                Gb = true;
                b ??= k.stdin;
                c ??= k.stdout;
                d ??= k.stderr;
                b ? W("stdin", b) : Vb("/dev/tty", "/dev/stdin");
                c ? W("stdout", null, c) : Vb("/dev/tty", "/dev/stdout");
                d ? W("stderr", null, d) : Vb("/dev/tty1", "/dev/stderr");
                ma("/dev/stdin", 0);
                ma("/dev/stdout", 1);
                ma("/dev/stderr", 1);
              }
              Xc.N();
              Hb = false;
              k.onRuntimeInitialized?.();
              if (k.postRun) for ("function" == typeof k.postRun && (k.postRun = [k.postRun]); k.postRun.length; ) {
                var d = k.postRun.shift();
                Ua.push(d);
              }
              Ta(Ua);
            }
          }
          if (0 < J) Xa = Wc;
          else {
            if (k.preRun) for ("function" == typeof k.preRun && (k.preRun = [k.preRun]); k.preRun.length; ) Wa();
            Ta(Va);
            0 < J ? Xa = Wc : k.setStatus ? (k.setStatus("Running..."), setTimeout(() => {
              setTimeout(() => k.setStatus(""), 1);
              a();
            }, 1)) : a();
          }
        }
        var Xc;
        (async function() {
          function a(c) {
            c = Xc = c.exports;
            k._sqlite3_free = c.P;
            k._sqlite3_value_text = c.Q;
            k._sqlite3_prepare_v2 = c.R;
            k._sqlite3_step = c.S;
            k._sqlite3_reset = c.T;
            k._sqlite3_exec = c.U;
            k._sqlite3_finalize = c.V;
            k._sqlite3_column_name = c.W;
            k._sqlite3_column_text = c.X;
            k._sqlite3_column_type = c.Y;
            k._sqlite3_errmsg = c.Z;
            k._sqlite3_clear_bindings = c._;
            k._sqlite3_value_blob = c.$;
            k._sqlite3_value_bytes = c.aa;
            k._sqlite3_value_double = c.ba;
            k._sqlite3_value_int = c.ca;
            k._sqlite3_value_type = c.da;
            k._sqlite3_result_blob = c.ea;
            k._sqlite3_result_double = c.fa;
            k._sqlite3_result_error = c.ga;
            k._sqlite3_result_int = c.ha;
            k._sqlite3_result_int64 = c.ia;
            k._sqlite3_result_null = c.ja;
            k._sqlite3_result_text = c.ka;
            k._sqlite3_aggregate_context = c.la;
            k._sqlite3_column_count = c.ma;
            k._sqlite3_data_count = c.na;
            k._sqlite3_column_blob = c.oa;
            k._sqlite3_column_bytes = c.pa;
            k._sqlite3_column_double = c.qa;
            k._sqlite3_bind_blob = c.ra;
            k._sqlite3_bind_double = c.sa;
            k._sqlite3_bind_int = c.ta;
            k._sqlite3_bind_text = c.ua;
            k._sqlite3_bind_parameter_index = c.va;
            k._sqlite3_sql = c.wa;
            k._sqlite3_normalized_sql = c.xa;
            k._sqlite3_changes = c.ya;
            k._sqlite3_close_v2 = c.za;
            k._sqlite3_create_function_v2 = c.Aa;
            k._sqlite3_update_hook = c.Ba;
            k._sqlite3_open = c.Ca;
            da = k._malloc = c.Da;
            ea = k._free = c.Ea;
            k._RegisterExtensionFunctions = c.Fa;
            Bb = c.Ga;
            Uc = c.Ha;
            ra = c.Ia;
            y = c.Ja;
            pa = c.Ka;
            La = c.M;
            Z = c.O;
            Ka();
            J--;
            k.monitorRunDependencies?.(J);
            0 == J && Xa && (c = Xa, Xa = null, c());
            return Xc;
          }
          J++;
          k.monitorRunDependencies?.(J);
          var b = { a: Vc };
          if (k.instantiateWasm) return new Promise((c) => {
            k.instantiateWasm(b, (d, e) => {
              c(a(d, e));
            });
          });
          Na ??= k.locateFile ? k.locateFile("sql-wasm.wasm", za) : za + "sql-wasm.wasm";
          return a((await Ra(b)).instance);
        })();
        Wc();
        return Module;
      });
      return initSqlJsPromise;
    };
    if (typeof exports2 === "object" && typeof module2 === "object") {
      module2.exports = initSqlJs;
      module2.exports.default = initSqlJs;
    } else if (typeof define === "function" && define["amd"]) {
      define([], function() {
        return initSqlJs;
      });
    } else if (typeof exports2 === "object") {
      exports2["Module"] = initSqlJs;
    }
  }
});

// node_modules/.pnpm/@foxglove+rosmsg@4.2.2/node_modules/@foxglove/rosmsg/dist/index.js
var require_dist4 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosmsg@4.2.2/node_modules/@foxglove/rosmsg/dist/index.js"(exports2, module2) {
    (() => {
      var __webpack_modules__ = {
        /***/
        417: (
          /***/
          ((__unused_webpack_module, __webpack_exports__2, __webpack_require__2) => {
            "use strict";
            __webpack_require__2.r(__webpack_exports__2);
            __webpack_require__2.d(__webpack_exports__2, {
              /* harmony export */
              "Md5": () => (
                /* binding */
                Md5
              )
              /* harmony export */
            });
            var Md5 = (
              /** @class */
              (function() {
                function Md52() {
                }
                Md52.AddUnsigned = function(lX, lY) {
                  var lX4, lY4, lX8, lY8, lResult;
                  lX8 = lX & 2147483648;
                  lY8 = lY & 2147483648;
                  lX4 = lX & 1073741824;
                  lY4 = lY & 1073741824;
                  lResult = (lX & 1073741823) + (lY & 1073741823);
                  if (!!(lX4 & lY4)) {
                    return lResult ^ 2147483648 ^ lX8 ^ lY8;
                  }
                  if (!!(lX4 | lY4)) {
                    if (!!(lResult & 1073741824)) {
                      return lResult ^ 3221225472 ^ lX8 ^ lY8;
                    } else {
                      return lResult ^ 1073741824 ^ lX8 ^ lY8;
                    }
                  } else {
                    return lResult ^ lX8 ^ lY8;
                  }
                };
                Md52.FF = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.F(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.GG = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.G(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.HH = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.H(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.II = function(a, b, c, d, x, s, ac) {
                  a = this.AddUnsigned(a, this.AddUnsigned(this.AddUnsigned(this.I(b, c, d), x), ac));
                  return this.AddUnsigned(this.RotateLeft(a, s), b);
                };
                Md52.ConvertToWordArray = function(string) {
                  var lWordCount, lMessageLength = string.length, lNumberOfWords_temp1 = lMessageLength + 8, lNumberOfWords_temp2 = (lNumberOfWords_temp1 - lNumberOfWords_temp1 % 64) / 64, lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16, lWordArray = Array(lNumberOfWords - 1), lBytePosition = 0, lByteCount = 0;
                  while (lByteCount < lMessageLength) {
                    lWordCount = (lByteCount - lByteCount % 4) / 4;
                    lBytePosition = lByteCount % 4 * 8;
                    lWordArray[lWordCount] = lWordArray[lWordCount] | string.charCodeAt(lByteCount) << lBytePosition;
                    lByteCount++;
                  }
                  lWordCount = (lByteCount - lByteCount % 4) / 4;
                  lBytePosition = lByteCount % 4 * 8;
                  lWordArray[lWordCount] = lWordArray[lWordCount] | 128 << lBytePosition;
                  lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
                  lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
                  return lWordArray;
                };
                Md52.WordToHex = function(lValue) {
                  var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
                  for (lCount = 0; lCount <= 3; lCount++) {
                    lByte = lValue >>> lCount * 8 & 255;
                    WordToHexValue_temp = "0" + lByte.toString(16);
                    WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
                  }
                  return WordToHexValue;
                };
                Md52.Utf8Encode = function(string) {
                  var utftext = "", c;
                  string = string.replace(/\r\n/g, "\n");
                  for (var n = 0; n < string.length; n++) {
                    c = string.charCodeAt(n);
                    if (c < 128) {
                      utftext += String.fromCharCode(c);
                    } else if (c > 127 && c < 2048) {
                      utftext += String.fromCharCode(c >> 6 | 192);
                      utftext += String.fromCharCode(c & 63 | 128);
                    } else {
                      utftext += String.fromCharCode(c >> 12 | 224);
                      utftext += String.fromCharCode(c >> 6 & 63 | 128);
                      utftext += String.fromCharCode(c & 63 | 128);
                    }
                  }
                  return utftext;
                };
                Md52.init = function(string) {
                  var temp;
                  if (typeof string !== "string")
                    string = JSON.stringify(string);
                  this._string = this.Utf8Encode(string);
                  this.x = this.ConvertToWordArray(this._string);
                  this.a = 1732584193;
                  this.b = 4023233417;
                  this.c = 2562383102;
                  this.d = 271733878;
                  for (this.k = 0; this.k < this.x.length; this.k += 16) {
                    this.AA = this.a;
                    this.BB = this.b;
                    this.CC = this.c;
                    this.DD = this.d;
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k], this.S11, 3614090360);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 1], this.S12, 3905402710);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 2], this.S13, 606105819);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 3], this.S14, 3250441966);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 4], this.S11, 4118548399);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 5], this.S12, 1200080426);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 6], this.S13, 2821735955);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 7], this.S14, 4249261313);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 8], this.S11, 1770035416);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 9], this.S12, 2336552879);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 10], this.S13, 4294925233);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 11], this.S14, 2304563134);
                    this.a = this.FF(this.a, this.b, this.c, this.d, this.x[this.k + 12], this.S11, 1804603682);
                    this.d = this.FF(this.d, this.a, this.b, this.c, this.x[this.k + 13], this.S12, 4254626195);
                    this.c = this.FF(this.c, this.d, this.a, this.b, this.x[this.k + 14], this.S13, 2792965006);
                    this.b = this.FF(this.b, this.c, this.d, this.a, this.x[this.k + 15], this.S14, 1236535329);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 1], this.S21, 4129170786);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 6], this.S22, 3225465664);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 11], this.S23, 643717713);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k], this.S24, 3921069994);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 5], this.S21, 3593408605);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 10], this.S22, 38016083);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 15], this.S23, 3634488961);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 4], this.S24, 3889429448);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 9], this.S21, 568446438);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 14], this.S22, 3275163606);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 3], this.S23, 4107603335);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 8], this.S24, 1163531501);
                    this.a = this.GG(this.a, this.b, this.c, this.d, this.x[this.k + 13], this.S21, 2850285829);
                    this.d = this.GG(this.d, this.a, this.b, this.c, this.x[this.k + 2], this.S22, 4243563512);
                    this.c = this.GG(this.c, this.d, this.a, this.b, this.x[this.k + 7], this.S23, 1735328473);
                    this.b = this.GG(this.b, this.c, this.d, this.a, this.x[this.k + 12], this.S24, 2368359562);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 5], this.S31, 4294588738);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 8], this.S32, 2272392833);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 11], this.S33, 1839030562);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 14], this.S34, 4259657740);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 1], this.S31, 2763975236);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 4], this.S32, 1272893353);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 7], this.S33, 4139469664);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 10], this.S34, 3200236656);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 13], this.S31, 681279174);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k], this.S32, 3936430074);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 3], this.S33, 3572445317);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 6], this.S34, 76029189);
                    this.a = this.HH(this.a, this.b, this.c, this.d, this.x[this.k + 9], this.S31, 3654602809);
                    this.d = this.HH(this.d, this.a, this.b, this.c, this.x[this.k + 12], this.S32, 3873151461);
                    this.c = this.HH(this.c, this.d, this.a, this.b, this.x[this.k + 15], this.S33, 530742520);
                    this.b = this.HH(this.b, this.c, this.d, this.a, this.x[this.k + 2], this.S34, 3299628645);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k], this.S41, 4096336452);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 7], this.S42, 1126891415);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 14], this.S43, 2878612391);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 5], this.S44, 4237533241);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 12], this.S41, 1700485571);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 3], this.S42, 2399980690);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 10], this.S43, 4293915773);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 1], this.S44, 2240044497);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 8], this.S41, 1873313359);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 15], this.S42, 4264355552);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 6], this.S43, 2734768916);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 13], this.S44, 1309151649);
                    this.a = this.II(this.a, this.b, this.c, this.d, this.x[this.k + 4], this.S41, 4149444226);
                    this.d = this.II(this.d, this.a, this.b, this.c, this.x[this.k + 11], this.S42, 3174756917);
                    this.c = this.II(this.c, this.d, this.a, this.b, this.x[this.k + 2], this.S43, 718787259);
                    this.b = this.II(this.b, this.c, this.d, this.a, this.x[this.k + 9], this.S44, 3951481745);
                    this.a = this.AddUnsigned(this.a, this.AA);
                    this.b = this.AddUnsigned(this.b, this.BB);
                    this.c = this.AddUnsigned(this.c, this.CC);
                    this.d = this.AddUnsigned(this.d, this.DD);
                  }
                  temp = this.WordToHex(this.a) + this.WordToHex(this.b) + this.WordToHex(this.c) + this.WordToHex(this.d);
                  return temp.toLowerCase();
                };
                Md52.x = Array();
                Md52.S11 = 7;
                Md52.S12 = 12;
                Md52.S13 = 17;
                Md52.S14 = 22;
                Md52.S21 = 5;
                Md52.S22 = 9;
                Md52.S23 = 14;
                Md52.S24 = 20;
                Md52.S31 = 4;
                Md52.S32 = 11;
                Md52.S33 = 16;
                Md52.S34 = 23;
                Md52.S41 = 6;
                Md52.S42 = 10;
                Md52.S43 = 15;
                Md52.S44 = 21;
                Md52.RotateLeft = function(lValue, iShiftBits) {
                  return lValue << iShiftBits | lValue >>> 32 - iShiftBits;
                };
                Md52.F = function(x, y, z) {
                  return x & y | ~x & z;
                };
                Md52.G = function(x, y, z) {
                  return x & z | y & ~z;
                };
                Md52.H = function(x, y, z) {
                  return x ^ y ^ z;
                };
                Md52.I = function(x, y, z) {
                  return y ^ (x | ~z);
                };
                return Md52;
              })()
            );
          })
        ),
        /***/
        271: (
          /***/
          (function(module3, exports3) {
            var __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;
            (function(root, factory) {
              if (true) {
                !(__WEBPACK_AMD_DEFINE_ARRAY__ = [], __WEBPACK_AMD_DEFINE_FACTORY__ = factory, __WEBPACK_AMD_DEFINE_RESULT__ = typeof __WEBPACK_AMD_DEFINE_FACTORY__ === "function" ? __WEBPACK_AMD_DEFINE_FACTORY__.apply(exports3, __WEBPACK_AMD_DEFINE_ARRAY__) : __WEBPACK_AMD_DEFINE_FACTORY__, __WEBPACK_AMD_DEFINE_RESULT__ !== void 0 && (module3.exports = __WEBPACK_AMD_DEFINE_RESULT__));
              } else {
              }
            })(this, function() {
              "use strict";
              var hasOwnProperty = Object.prototype.hasOwnProperty;
              var toString = Object.prototype.toString;
              var hasSticky = typeof new RegExp().sticky === "boolean";
              function isRegExp(o) {
                return o && toString.call(o) === "[object RegExp]";
              }
              function isObject2(o) {
                return o && typeof o === "object" && !isRegExp(o) && !Array.isArray(o);
              }
              function reEscape(s) {
                return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
              }
              function reGroups(s) {
                var re = new RegExp("|" + s);
                return re.exec("").length - 1;
              }
              function reCapture(s) {
                return "(" + s + ")";
              }
              function reUnion(regexps) {
                if (!regexps.length) return "(?!)";
                var source = regexps.map(function(s) {
                  return "(?:" + s + ")";
                }).join("|");
                return "(?:" + source + ")";
              }
              function regexpOrLiteral(obj) {
                if (typeof obj === "string") {
                  return "(?:" + reEscape(obj) + ")";
                } else if (isRegExp(obj)) {
                  if (obj.ignoreCase) throw new Error("RegExp /i flag not allowed");
                  if (obj.global) throw new Error("RegExp /g flag is implied");
                  if (obj.sticky) throw new Error("RegExp /y flag is implied");
                  if (obj.multiline) throw new Error("RegExp /m flag is implied");
                  return obj.source;
                } else {
                  throw new Error("Not a pattern: " + obj);
                }
              }
              function objectToRules(object) {
                var keys = Object.getOwnPropertyNames(object);
                var result = [];
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  var thing = object[key];
                  var rules = [].concat(thing);
                  if (key === "include") {
                    for (var j = 0; j < rules.length; j++) {
                      result.push({ include: rules[j] });
                    }
                    continue;
                  }
                  var match = [];
                  rules.forEach(function(rule) {
                    if (isObject2(rule)) {
                      if (match.length) result.push(ruleOptions(key, match));
                      result.push(ruleOptions(key, rule));
                      match = [];
                    } else {
                      match.push(rule);
                    }
                  });
                  if (match.length) result.push(ruleOptions(key, match));
                }
                return result;
              }
              function arrayToRules(array) {
                var result = [];
                for (var i = 0; i < array.length; i++) {
                  var obj = array[i];
                  if (obj.include) {
                    var include = [].concat(obj.include);
                    for (var j = 0; j < include.length; j++) {
                      result.push({ include: include[j] });
                    }
                    continue;
                  }
                  if (!obj.type) {
                    throw new Error("Rule has no type: " + JSON.stringify(obj));
                  }
                  result.push(ruleOptions(obj.type, obj));
                }
                return result;
              }
              function ruleOptions(type, obj) {
                if (!isObject2(obj)) {
                  obj = { match: obj };
                }
                if (obj.include) {
                  throw new Error("Matching rules cannot also include states");
                }
                var options = {
                  defaultType: type,
                  lineBreaks: !!obj.error || !!obj.fallback,
                  pop: false,
                  next: null,
                  push: null,
                  error: false,
                  fallback: false,
                  value: null,
                  type: null,
                  shouldThrow: false
                };
                for (var key in obj) {
                  if (hasOwnProperty.call(obj, key)) {
                    options[key] = obj[key];
                  }
                }
                if (typeof options.type === "string" && type !== options.type) {
                  throw new Error("Type transform cannot be a string (type '" + options.type + "' for token '" + type + "')");
                }
                var match = options.match;
                options.match = Array.isArray(match) ? match : match ? [match] : [];
                options.match.sort(function(a, b) {
                  return isRegExp(a) && isRegExp(b) ? 0 : isRegExp(b) ? -1 : isRegExp(a) ? 1 : b.length - a.length;
                });
                return options;
              }
              function toRules(spec) {
                return Array.isArray(spec) ? arrayToRules(spec) : objectToRules(spec);
              }
              var defaultErrorRule = ruleOptions("error", { lineBreaks: true, shouldThrow: true });
              function compileRules(rules, hasStates) {
                var errorRule = null;
                var fast = /* @__PURE__ */ Object.create(null);
                var fastAllowed = true;
                var unicodeFlag = null;
                var groups = [];
                var parts = [];
                for (var i = 0; i < rules.length; i++) {
                  if (rules[i].fallback) {
                    fastAllowed = false;
                  }
                }
                for (var i = 0; i < rules.length; i++) {
                  var options = rules[i];
                  if (options.include) {
                    throw new Error("Inheritance is not allowed in stateless lexers");
                  }
                  if (options.error || options.fallback) {
                    if (errorRule) {
                      if (!options.fallback === !errorRule.fallback) {
                        throw new Error("Multiple " + (options.fallback ? "fallback" : "error") + " rules not allowed (for token '" + options.defaultType + "')");
                      } else {
                        throw new Error("fallback and error are mutually exclusive (for token '" + options.defaultType + "')");
                      }
                    }
                    errorRule = options;
                  }
                  var match = options.match.slice();
                  if (fastAllowed) {
                    while (match.length && typeof match[0] === "string" && match[0].length === 1) {
                      var word = match.shift();
                      fast[word.charCodeAt(0)] = options;
                    }
                  }
                  if (options.pop || options.push || options.next) {
                    if (!hasStates) {
                      throw new Error("State-switching options are not allowed in stateless lexers (for token '" + options.defaultType + "')");
                    }
                    if (options.fallback) {
                      throw new Error("State-switching options are not allowed on fallback tokens (for token '" + options.defaultType + "')");
                    }
                  }
                  if (match.length === 0) {
                    continue;
                  }
                  fastAllowed = false;
                  groups.push(options);
                  for (var j = 0; j < match.length; j++) {
                    var obj = match[j];
                    if (!isRegExp(obj)) {
                      continue;
                    }
                    if (unicodeFlag === null) {
                      unicodeFlag = obj.unicode;
                    } else if (unicodeFlag !== obj.unicode && options.fallback === false) {
                      throw new Error("If one rule is /u then all must be");
                    }
                  }
                  var pat = reUnion(match.map(regexpOrLiteral));
                  var regexp = new RegExp(pat);
                  if (regexp.test("")) {
                    throw new Error("RegExp matches empty string: " + regexp);
                  }
                  var groupCount = reGroups(pat);
                  if (groupCount > 0) {
                    throw new Error("RegExp has capture groups: " + regexp + "\nUse (?: \u2026 ) instead");
                  }
                  if (!options.lineBreaks && regexp.test("\n")) {
                    throw new Error("Rule should declare lineBreaks: " + regexp);
                  }
                  parts.push(reCapture(pat));
                }
                var fallbackRule = errorRule && errorRule.fallback;
                var flags = hasSticky && !fallbackRule ? "ym" : "gm";
                var suffix = hasSticky || fallbackRule ? "" : "|";
                if (unicodeFlag === true) flags += "u";
                var combined = new RegExp(reUnion(parts) + suffix, flags);
                return { regexp: combined, groups, fast, error: errorRule || defaultErrorRule };
              }
              function compile(rules) {
                var result = compileRules(toRules(rules));
                return new Lexer({ start: result }, "start");
              }
              function checkStateGroup(g, name, map) {
                var state = g && (g.push || g.next);
                if (state && !map[state]) {
                  throw new Error("Missing state '" + state + "' (in token '" + g.defaultType + "' of state '" + name + "')");
                }
                if (g && g.pop && +g.pop !== 1) {
                  throw new Error("pop must be 1 (in token '" + g.defaultType + "' of state '" + name + "')");
                }
              }
              function compileStates(states, start) {
                var all = states.$all ? toRules(states.$all) : [];
                delete states.$all;
                var keys = Object.getOwnPropertyNames(states);
                if (!start) start = keys[0];
                var ruleMap = /* @__PURE__ */ Object.create(null);
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  ruleMap[key] = toRules(states[key]).concat(all);
                }
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  var rules = ruleMap[key];
                  var included = /* @__PURE__ */ Object.create(null);
                  for (var j = 0; j < rules.length; j++) {
                    var rule = rules[j];
                    if (!rule.include) continue;
                    var splice = [j, 1];
                    if (rule.include !== key && !included[rule.include]) {
                      included[rule.include] = true;
                      var newRules = ruleMap[rule.include];
                      if (!newRules) {
                        throw new Error("Cannot include nonexistent state '" + rule.include + "' (in state '" + key + "')");
                      }
                      for (var k = 0; k < newRules.length; k++) {
                        var newRule = newRules[k];
                        if (rules.indexOf(newRule) !== -1) continue;
                        splice.push(newRule);
                      }
                    }
                    rules.splice.apply(rules, splice);
                    j--;
                  }
                }
                var map = /* @__PURE__ */ Object.create(null);
                for (var i = 0; i < keys.length; i++) {
                  var key = keys[i];
                  map[key] = compileRules(ruleMap[key], true);
                }
                for (var i = 0; i < keys.length; i++) {
                  var name = keys[i];
                  var state = map[name];
                  var groups = state.groups;
                  for (var j = 0; j < groups.length; j++) {
                    checkStateGroup(groups[j], name, map);
                  }
                  var fastKeys = Object.getOwnPropertyNames(state.fast);
                  for (var j = 0; j < fastKeys.length; j++) {
                    checkStateGroup(state.fast[fastKeys[j]], name, map);
                  }
                }
                return new Lexer(map, start);
              }
              function keywordTransform(map) {
                var reverseMap = /* @__PURE__ */ Object.create(null);
                var byLength = /* @__PURE__ */ Object.create(null);
                var types2 = Object.getOwnPropertyNames(map);
                for (var i = 0; i < types2.length; i++) {
                  var tokenType = types2[i];
                  var item = map[tokenType];
                  var keywordList = Array.isArray(item) ? item : [item];
                  keywordList.forEach(function(keyword) {
                    (byLength[keyword.length] = byLength[keyword.length] || []).push(keyword);
                    if (typeof keyword !== "string") {
                      throw new Error("keyword must be string (in keyword '" + tokenType + "')");
                    }
                    reverseMap[keyword] = tokenType;
                  });
                }
                function str(x) {
                  return JSON.stringify(x);
                }
                var source = "";
                source += "switch (value.length) {\n";
                for (var length in byLength) {
                  var keywords = byLength[length];
                  source += "case " + length + ":\n";
                  source += "switch (value) {\n";
                  keywords.forEach(function(keyword) {
                    var tokenType2 = reverseMap[keyword];
                    source += "case " + str(keyword) + ": return " + str(tokenType2) + "\n";
                  });
                  source += "}\n";
                }
                source += "}\n";
                return Function("value", source);
              }
              var Lexer = function(states, state) {
                this.startState = state;
                this.states = states;
                this.buffer = "";
                this.stack = [];
                this.reset();
              };
              Lexer.prototype.reset = function(data, info) {
                this.buffer = data || "";
                this.index = 0;
                this.line = info ? info.line : 1;
                this.col = info ? info.col : 1;
                this.queuedToken = info ? info.queuedToken : null;
                this.queuedThrow = info ? info.queuedThrow : null;
                this.setState(info ? info.state : this.startState);
                this.stack = info && info.stack ? info.stack.slice() : [];
                return this;
              };
              Lexer.prototype.save = function() {
                return {
                  line: this.line,
                  col: this.col,
                  state: this.state,
                  stack: this.stack.slice(),
                  queuedToken: this.queuedToken,
                  queuedThrow: this.queuedThrow
                };
              };
              Lexer.prototype.setState = function(state) {
                if (!state || this.state === state) return;
                this.state = state;
                var info = this.states[state];
                this.groups = info.groups;
                this.error = info.error;
                this.re = info.regexp;
                this.fast = info.fast;
              };
              Lexer.prototype.popState = function() {
                this.setState(this.stack.pop());
              };
              Lexer.prototype.pushState = function(state) {
                this.stack.push(this.state);
                this.setState(state);
              };
              var eat = hasSticky ? function(re, buffer) {
                return re.exec(buffer);
              } : function(re, buffer) {
                var match = re.exec(buffer);
                if (match[0].length === 0) {
                  return null;
                }
                return match;
              };
              Lexer.prototype._getGroup = function(match) {
                var groupCount = this.groups.length;
                for (var i = 0; i < groupCount; i++) {
                  if (match[i + 1] !== void 0) {
                    return this.groups[i];
                  }
                }
                throw new Error("Cannot find token type for matched text");
              };
              function tokenToString() {
                return this.value;
              }
              Lexer.prototype.next = function() {
                var index = this.index;
                if (this.queuedGroup) {
                  var token = this._token(this.queuedGroup, this.queuedText, index);
                  this.queuedGroup = null;
                  this.queuedText = "";
                  return token;
                }
                var buffer = this.buffer;
                if (index === buffer.length) {
                  return;
                }
                var group = this.fast[buffer.charCodeAt(index)];
                if (group) {
                  return this._token(group, buffer.charAt(index), index);
                }
                var re = this.re;
                re.lastIndex = index;
                var match = eat(re, buffer);
                var error = this.error;
                if (match == null) {
                  return this._token(error, buffer.slice(index, buffer.length), index);
                }
                var group = this._getGroup(match);
                var text = match[0];
                if (error.fallback && match.index !== index) {
                  this.queuedGroup = group;
                  this.queuedText = text;
                  return this._token(error, buffer.slice(index, match.index), index);
                }
                return this._token(group, text, index);
              };
              Lexer.prototype._token = function(group, text, offset) {
                var lineBreaks = 0;
                if (group.lineBreaks) {
                  var matchNL = /\n/g;
                  var nl = 1;
                  if (text === "\n") {
                    lineBreaks = 1;
                  } else {
                    while (matchNL.exec(text)) {
                      lineBreaks++;
                      nl = matchNL.lastIndex;
                    }
                  }
                }
                var token = {
                  type: typeof group.type === "function" && group.type(text) || group.defaultType,
                  value: typeof group.value === "function" ? group.value(text) : text,
                  text,
                  toString: tokenToString,
                  offset,
                  lineBreaks,
                  line: this.line,
                  col: this.col
                };
                var size = text.length;
                this.index += size;
                this.line += lineBreaks;
                if (lineBreaks !== 0) {
                  this.col = size - nl + 1;
                } else {
                  this.col += size;
                }
                if (group.shouldThrow) {
                  throw new Error(this.formatError(token, "invalid syntax"));
                }
                if (group.pop) this.popState();
                else if (group.push) this.pushState(group.push);
                else if (group.next) this.setState(group.next);
                return token;
              };
              if (typeof Symbol !== "undefined" && Symbol.iterator) {
                var LexerIterator = function(lexer) {
                  this.lexer = lexer;
                };
                LexerIterator.prototype.next = function() {
                  var token = this.lexer.next();
                  return { value: token, done: !token };
                };
                LexerIterator.prototype[Symbol.iterator] = function() {
                  return this;
                };
                Lexer.prototype[Symbol.iterator] = function() {
                  return new LexerIterator(this);
                };
              }
              Lexer.prototype.formatError = function(token, message) {
                if (token == null) {
                  var text = this.buffer.slice(this.index);
                  var token = {
                    text,
                    offset: this.index,
                    lineBreaks: text.indexOf("\n") === -1 ? 0 : 1,
                    line: this.line,
                    col: this.col
                  };
                }
                var start = Math.max(0, token.offset - token.col + 1);
                var eol = token.lineBreaks ? token.text.indexOf("\n") : token.text.length;
                var firstLine = this.buffer.substring(start, token.offset + eol);
                message += " at line " + token.line + " col " + token.col + ":\n\n";
                message += "  " + firstLine + "\n";
                message += "  " + Array(token.col).join(" ") + "^";
                return message;
              };
              Lexer.prototype.clone = function() {
                return new Lexer(this.states, this.state);
              };
              Lexer.prototype.has = function(tokenType) {
                return true;
              };
              return {
                compile,
                states: compileStates,
                error: Object.freeze({ error: true }),
                fallback: Object.freeze({ fallback: true }),
                keywords: keywordTransform
              };
            });
          })
        ),
        /***/
        558: (
          /***/
          ((module3, __unused_webpack_exports, __webpack_require__2) => {
            (function() {
              function id(x) {
                return x[0];
              }
              const moo = __webpack_require__2(271);
              const lexer = moo.compile({
                space: { match: /\s+/, lineBreaks: true },
                number: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\b/,
                comment: /#[^\n]*/,
                "[": "[",
                "]": "]",
                assignment: /=[^\n]*/,
                // Leading underscores are disallowed in field names, while constant names have no explicit restrictions.
                // So we are more lenient in lexing here, and the validation steps below are more strict.
                // See: https://github.com/ros/genmsg/blob/7d8b6ce6f43b6e39ea8261125d270f2d3062356f/src/genmsg/msg_loader.py#L188-L238
                fieldOrType: /[a-zA-Z_][a-zA-Z0-9_]*(?:\/[a-zA-Z][a-zA-Z0-9_]*)?/
              });
              function extend(objs) {
                return objs.reduce((r, p) => ({ ...r, ...p }), {});
              }
              var grammar = {
                Lexer: lexer,
                ParserRules: [
                  { "name": "main$ebnf$1", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "boolType", "arrayType", "__", "field", "_", "main$ebnf$1", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$2", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$2", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "bigintType", "arrayType", "__", "field", "_", "main$ebnf$2", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$3", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$3", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "numericType", "arrayType", "__", "field", "_", "main$ebnf$3", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$4", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$4", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "stringType", "arrayType", "__", "field", "_", "main$ebnf$4", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$5", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$5", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "timeType", "arrayType", "__", "field", "_", "main$ebnf$5", "simple"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$6", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$6", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "customType", "arrayType", "__", "field", "_", "main$ebnf$6", "complex"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$7", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$7", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "boolType", "__", "constantField", "_", "boolConstantValue", "_", "main$ebnf$7"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$8", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$8", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "bigintType", "__", "constantField", "_", "bigintConstantValue", "_", "main$ebnf$8"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$9", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$9", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "numericType", "__", "constantField", "_", "numericConstantValue", "_", "main$ebnf$9"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main$ebnf$10", "symbols": ["comment"], "postprocess": id },
                  { "name": "main$ebnf$10", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["_", "stringType", "__", "constantField", "_", "stringConstantValue", "_", "main$ebnf$10"], "postprocess": function(d) {
                    return extend(d);
                  } },
                  { "name": "main", "symbols": ["comment"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main", "symbols": ["blankLine"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "boolType", "symbols": [{ "literal": "bool" }], "postprocess": function(d) {
                    return { type: d[0].value };
                  } },
                  { "name": "bigintType$subexpression$1", "symbols": [{ "literal": "int64" }] },
                  { "name": "bigintType$subexpression$1", "symbols": [{ "literal": "uint64" }] },
                  { "name": "bigintType", "symbols": ["bigintType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "byte" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "char" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "float32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "float64" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint32" }] },
                  { "name": "numericType", "symbols": ["numericType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "stringType", "symbols": [{ "literal": "string" }], "postprocess": function(d) {
                    return { type: d[0].value };
                  } },
                  { "name": "timeType$subexpression$1", "symbols": [{ "literal": "time" }] },
                  { "name": "timeType$subexpression$1", "symbols": [{ "literal": "duration" }] },
                  { "name": "timeType", "symbols": ["timeType$subexpression$1"], "postprocess": function(d) {
                    return { type: d[0][0].value };
                  } },
                  { "name": "customType", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const PRIMITIVE_TYPES = ["bool", "byte", "char", "float32", "float64", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "string", "time", "duration"];
                    const type = d[0].value;
                    if (PRIMITIVE_TYPES.includes(type)) return reject;
                    return { type };
                  } },
                  { "name": "arrayType", "symbols": [{ "literal": "[" }, "_", { "literal": "]" }], "postprocess": function(d) {
                    return { isArray: true };
                  } },
                  { "name": "arrayType", "symbols": [{ "literal": "[" }, "_", "number", "_", { "literal": "]" }], "postprocess": function(d) {
                    return { isArray: true, arrayLength: d[2] };
                  } },
                  { "name": "arrayType", "symbols": ["_"], "postprocess": function(d) {
                    return { isArray: false };
                  } },
                  { "name": "field", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const name = d[0].value;
                    if (name.match(/^[a-zA-Z][a-zA-Z0-9_]*$/) == void 0) return reject;
                    return { name };
                  } },
                  { "name": "constantField", "symbols": [lexer.has("fieldOrType") ? { type: "fieldOrType" } : fieldOrType], "postprocess": function(d, _, reject) {
                    const name = d[0].value;
                    if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) == void 0) return reject;
                    return { name, isConstant: true };
                  } },
                  { "name": "boolConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    if (valueText === "True" || valueText === "1") return { value: true, valueText };
                    if (valueText === "False" || valueText === "0") return { value: false, valueText };
                    return reject;
                  } },
                  { "name": "numericConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    const value = parseFloat(valueText);
                    return !isNaN(value) ? { value, valueText } : reject;
                  } },
                  { "name": "bigintConstantValue", "symbols": ["assignment"], "postprocess": function(d, _, reject) {
                    const valueText = d[0].split("#")[0].trim();
                    try {
                      const value = BigInt(valueText);
                      return { value, valueText };
                    } catch {
                      return reject;
                    }
                  } },
                  { "name": "stringConstantValue", "symbols": ["assignment"], "postprocess": function(d) {
                    return { value: d[0], valueText: d[0] };
                  } },
                  { "name": "bool$subexpression$1", "symbols": [{ "literal": "True" }] },
                  { "name": "bool$subexpression$1", "symbols": [{ "literal": "1" }] },
                  { "name": "bool", "symbols": ["bool$subexpression$1"], "postprocess": function(d) {
                    return true;
                  } },
                  { "name": "bool$subexpression$2", "symbols": [{ "literal": "False" }] },
                  { "name": "bool$subexpression$2", "symbols": [{ "literal": "0" }] },
                  { "name": "bool", "symbols": ["bool$subexpression$2"], "postprocess": function(d) {
                    return false;
                  } },
                  { "name": "number", "symbols": [lexer.has("number") ? { type: "number" } : number], "postprocess": function(d) {
                    return parseFloat(d[0].value);
                  } },
                  { "name": "assignment", "symbols": [lexer.has("assignment") ? { type: "assignment" } : assignment], "postprocess": function(d) {
                    return d[0].value.substr(1).trim();
                  } },
                  { "name": "comment", "symbols": [lexer.has("comment") ? { type: "comment" } : comment], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "blankLine", "symbols": ["_"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "_$subexpression$1", "symbols": [] },
                  { "name": "_$subexpression$1", "symbols": [lexer.has("space") ? { type: "space" } : space] },
                  { "name": "_", "symbols": ["_$subexpression$1"], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "__", "symbols": [lexer.has("space") ? { type: "space" } : space], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "simple", "symbols": [], "postprocess": function() {
                    return { isComplex: false };
                  } },
                  { "name": "complex", "symbols": [], "postprocess": function() {
                    return { isComplex: true };
                  } }
                ],
                ParserStart: "main"
              };
              if (typeof module3.exports !== "undefined") {
                module3.exports = grammar;
              } else {
                window.grammar = grammar;
              }
            })();
          })
        ),
        /***/
        568: (
          /***/
          ((module3, __unused_webpack_exports, __webpack_require__2) => {
            (function() {
              function id(x) {
                return x[0];
              }
              const keywords = [
                ,
                "struct",
                "module",
                "const",
                "include",
                "typedef",
                "boolean",
                "wstring",
                "string",
                "sequence",
                "TRUE",
                "FALSE",
                "byte",
                "octet",
                "wchar",
                "char",
                "double",
                "float",
                "int8",
                "uint8",
                "int16",
                "uint16",
                "int32",
                "uint32",
                "int64",
                "uint64",
                "unsigned",
                "short",
                "long"
              ];
              const kwObject = keywords.reduce((obj, w) => {
                obj[w] = w;
                return obj;
              }, {});
              const moo = __webpack_require__2(271);
              const lexer = moo.compile({
                SPACE: { match: /\s+/, lineBreaks: true },
                DECIMALEXP: /(?:(?:\d+\.\d*)|(?:\d*\.\d+)|(?:[0-9]+))[eE](?:[+|-])?[0-9]+/,
                DECIMAL: /(?:(?:\d+\.\d*)|(?:\d*\.\d+))/,
                INTEGER: /\d+/,
                COMMENT: /(?:\/\/[^\n]*)|(?:\/\*(?:.|\n)+?\*\/)/,
                HEX_LITERAL: /0x(?:[0-9a-fA-F])+?/,
                STRING: { match: /"(?:\\["\\rnu]|[^"\\])*"/, value: (x) => x.slice(1, -1) },
                // remove outside quotes
                LCBR: "{",
                RCBR: "}",
                LBR: "[",
                RBR: "]",
                LT: "<",
                GT: ">",
                LPAR: "(",
                RPAR: ")",
                ";": ";",
                ",": ",",
                AT: "@",
                PND: "#",
                PT: ".",
                "/": "/",
                SIGN: /[+-]/,
                HEADER: /={80}\nIDL: [a-zA-Z][\w]+(?:\/[a-zA-Z][\w]+)*/,
                EQ: /=[^\n]*?/,
                NAME: { match: /[a-zA-Z_][a-zA-Z0-9_]*(?:\:\:[a-zA-Z][a-zA-Z0-9_]*)*/, type: moo.keywords(kwObject) }
              });
              const tokensToIgnore = ["SPACE", "COMMENT"];
              lexer.next = /* @__PURE__ */ ((next) => () => {
                let token;
                while ((token = next.call(lexer)) && tokensToIgnore.includes(token.type)) {
                }
                return token;
              })(lexer.next);
              const numericTypeMap = {
                "unsigned short": "uint16",
                "unsigned long": "uint32",
                "unsigned long long": "uint64",
                "short": "int16",
                "long": "int32",
                "long long": "int64",
                "double": "float64",
                "float": "float32",
                "octet": "byte",
                "wchar": "char"
              };
              function join2(d) {
                return d.join("");
              }
              function extend(objs) {
                return objs.reduce((r, p) => ({ ...r, ...p }), {});
              }
              function noop() {
                return null;
              }
              function getIntOrConstantValue(d) {
                const int = parseInt(d);
                if (!isNaN(int)) {
                  return int;
                }
                return d?.value ? { usesConstant: true, name: d.value } : void 0;
              }
              function aggregateConstantUsage(dcl) {
                const entries = Object.entries(dcl).filter(
                  ([key, value]) => value?.usesConstant === true
                ).map(([key, { name }]) => [key, name]);
                return {
                  ...dcl,
                  constantUsage: entries
                };
              }
              var grammar = {
                Lexer: lexer,
                ParserRules: [
                  { "name": "main$ebnf$1$subexpression$1$ebnf$1", "symbols": ["header"], "postprocess": id },
                  { "name": "main$ebnf$1$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main$ebnf$1$subexpression$1$ebnf$2", "symbols": [] },
                  { "name": "main$ebnf$1$subexpression$1$ebnf$2", "symbols": ["main$ebnf$1$subexpression$1$ebnf$2", "importDcl"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "main$ebnf$1$subexpression$1$ebnf$3", "symbols": ["definition"] },
                  { "name": "main$ebnf$1$subexpression$1$ebnf$3", "symbols": ["main$ebnf$1$subexpression$1$ebnf$3", "definition"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "main$ebnf$1$subexpression$1", "symbols": ["main$ebnf$1$subexpression$1$ebnf$1", "main$ebnf$1$subexpression$1$ebnf$2", "main$ebnf$1$subexpression$1$ebnf$3"] },
                  { "name": "main$ebnf$1", "symbols": ["main$ebnf$1$subexpression$1"] },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$1", "symbols": ["header"], "postprocess": id },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$2", "symbols": [] },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$2", "symbols": ["main$ebnf$1$subexpression$2$ebnf$2", "importDcl"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$3", "symbols": ["definition"] },
                  { "name": "main$ebnf$1$subexpression$2$ebnf$3", "symbols": ["main$ebnf$1$subexpression$2$ebnf$3", "definition"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "main$ebnf$1$subexpression$2", "symbols": ["main$ebnf$1$subexpression$2$ebnf$1", "main$ebnf$1$subexpression$2$ebnf$2", "main$ebnf$1$subexpression$2$ebnf$3"] },
                  { "name": "main$ebnf$1", "symbols": ["main$ebnf$1", "main$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  {
                    "name": "main",
                    "symbols": ["main$ebnf$1"],
                    "postprocess": (d) => {
                      return d[0].flatMap((inner) => inner[2].flat());
                    }
                  },
                  { "name": "header", "symbols": [lexer.has("HEADER") ? { type: "HEADER" } : HEADER], "postprocess": noop },
                  { "name": "importDcl$subexpression$1", "symbols": [lexer.has("STRING") ? { type: "STRING" } : STRING] },
                  { "name": "importDcl$subexpression$1$ebnf$1", "symbols": [] },
                  { "name": "importDcl$subexpression$1$ebnf$1$subexpression$1", "symbols": [{ "literal": "/" }, lexer.has("NAME") ? { type: "NAME" } : NAME] },
                  { "name": "importDcl$subexpression$1$ebnf$1", "symbols": ["importDcl$subexpression$1$ebnf$1", "importDcl$subexpression$1$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "importDcl$subexpression$1", "symbols": [{ "literal": "<" }, lexer.has("NAME") ? { type: "NAME" } : NAME, "importDcl$subexpression$1$ebnf$1", { "literal": "." }, { "literal": "idl" }, { "literal": ">" }] },
                  { "name": "importDcl", "symbols": [{ "literal": "#" }, { "literal": "include" }, "importDcl$subexpression$1"], "postprocess": noop },
                  { "name": "moduleDcl$ebnf$1$subexpression$1", "symbols": ["definition"] },
                  { "name": "moduleDcl$ebnf$1", "symbols": ["moduleDcl$ebnf$1$subexpression$1"] },
                  { "name": "moduleDcl$ebnf$1$subexpression$2", "symbols": ["definition"] },
                  { "name": "moduleDcl$ebnf$1", "symbols": ["moduleDcl$ebnf$1", "moduleDcl$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  {
                    "name": "moduleDcl",
                    "symbols": ["multiAnnotations", { "literal": "module" }, "fieldName", { "literal": "{" }, "moduleDcl$ebnf$1", { "literal": "}" }],
                    "postprocess": function processModule(d) {
                      const moduleName = d[2].name;
                      const defs = d[4];
                      return {
                        definitionType: "module",
                        name: moduleName,
                        definitions: defs.flat(1)
                      };
                    }
                  },
                  { "name": "definition$subexpression$1", "symbols": ["typeDcl"] },
                  { "name": "definition$subexpression$1", "symbols": ["constantDcl"] },
                  { "name": "definition$subexpression$1", "symbols": ["moduleDcl"] },
                  { "name": "definition", "symbols": ["definition$subexpression$1", "semi"], "postprocess": (d) => d[0][0] },
                  { "name": "typeDcl$subexpression$1", "symbols": ["structWithAnnotations"] },
                  { "name": "typeDcl$subexpression$1", "symbols": ["typedefWithAnnotations"] },
                  { "name": "typeDcl", "symbols": ["typeDcl$subexpression$1"], "postprocess": (d) => d[0][0] },
                  {
                    "name": "structWithAnnotations",
                    "symbols": ["multiAnnotations", "struct"],
                    "postprocess": (
                      // default values don't apply to structs so we can just ignore all annotations on structs
                      (d) => d[1]
                    )
                  },
                  { "name": "struct$ebnf$1$subexpression$1", "symbols": ["member"] },
                  { "name": "struct$ebnf$1", "symbols": ["struct$ebnf$1$subexpression$1"] },
                  { "name": "struct$ebnf$1$subexpression$2", "symbols": ["member"] },
                  { "name": "struct$ebnf$1", "symbols": ["struct$ebnf$1", "struct$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "struct", "symbols": [{ "literal": "struct" }, "fieldName", { "literal": "{" }, "struct$ebnf$1", { "literal": "}" }], "postprocess": (d) => {
                    const name = d[1].name;
                    const definitions = d[3].flat(2).filter((def) => def !== null);
                    return {
                      definitionType: "struct",
                      name,
                      definitions
                    };
                  } },
                  { "name": "typedefWithAnnotations$subexpression$1", "symbols": ["typedef", "allTypes", "fieldName", "arrayLength"] },
                  { "name": "typedefWithAnnotations$subexpression$1", "symbols": ["typedef", "allTypes", "fieldName"] },
                  { "name": "typedefWithAnnotations$subexpression$1", "symbols": ["typedef", "sequenceType", "fieldName"] },
                  { "name": "typedefWithAnnotations", "symbols": ["multiAnnotations", "typedefWithAnnotations$subexpression$1"], "postprocess": (d) => {
                    const def = aggregateConstantUsage(extend(d.flat(1)));
                    return {
                      definitionType: "typedef",
                      ...def
                    };
                  } },
                  { "name": "typedef", "symbols": [{ "literal": "typedef" }], "postprocess": noop },
                  { "name": "constantDcl", "symbols": ["multiAnnotations", "constType"], "postprocess": (d) => d[1] },
                  { "name": "member", "symbols": ["fieldWithAnnotation", "semi"], "postprocess": (d) => d[0] },
                  { "name": "fieldWithAnnotation", "symbols": ["multiAnnotations", "fieldDcl"], "postprocess": (d) => {
                    let possibleAnnotations = [];
                    if (d[0]) {
                      possibleAnnotations = d[0];
                    }
                    const fields = d[1];
                    const finalDefs = fields.map(
                      (def) => aggregateConstantUsage(extend([...possibleAnnotations, def]))
                    );
                    return finalDefs;
                  } },
                  { "name": "fieldDcl$subexpression$1", "symbols": ["allTypes", "multiFieldNames", "arrayLength"] },
                  { "name": "fieldDcl$subexpression$1", "symbols": ["allTypes", "multiFieldNames"] },
                  { "name": "fieldDcl$subexpression$1", "symbols": ["sequenceType", "multiFieldNames"] },
                  { "name": "fieldDcl", "symbols": ["fieldDcl$subexpression$1"], "postprocess": (d) => {
                    const names = d[0].splice(1, 1)[0];
                    const defs = names.map((nameObj) => extend([...d[0], nameObj]));
                    return defs;
                  } },
                  { "name": "multiFieldNames$ebnf$1", "symbols": [] },
                  { "name": "multiFieldNames$ebnf$1$subexpression$1", "symbols": [{ "literal": "," }, "fieldName"] },
                  { "name": "multiFieldNames$ebnf$1", "symbols": ["multiFieldNames$ebnf$1", "multiFieldNames$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "multiFieldNames", "symbols": ["fieldName", "multiFieldNames$ebnf$1"], "postprocess": (d) => {
                    const fieldNames = d.flat(2).filter((d2) => d2 !== null && d2.name);
                    return fieldNames;
                  } },
                  { "name": "multiAnnotations$ebnf$1", "symbols": [] },
                  { "name": "multiAnnotations$ebnf$1", "symbols": ["multiAnnotations$ebnf$1", "annotation"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  {
                    "name": "multiAnnotations",
                    "symbols": ["multiAnnotations$ebnf$1"],
                    "postprocess": (d) => {
                      return d[0] ? d[0].filter((d2) => d2 !== null) : null;
                    }
                  },
                  { "name": "annotation$ebnf$1$subexpression$1", "symbols": [{ "literal": "(" }, "multiAnnotationParams", { "literal": ")" }] },
                  { "name": "annotation$ebnf$1", "symbols": ["annotation$ebnf$1$subexpression$1"], "postprocess": id },
                  { "name": "annotation$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "annotation", "symbols": ["at", lexer.has("NAME") ? { type: "NAME" } : NAME, "annotation$ebnf$1"], "postprocess": (d) => {
                    const paramsMap = d[2] ? d[2][1] : {};
                    if (d[1].value === "default") {
                      const defaultValue = paramsMap.value;
                      return { defaultValue };
                    }
                    return null;
                  } },
                  { "name": "multiAnnotationParams$ebnf$1", "symbols": [] },
                  { "name": "multiAnnotationParams$ebnf$1$subexpression$1", "symbols": [{ "literal": "," }, "annotationParam"] },
                  { "name": "multiAnnotationParams$ebnf$1", "symbols": ["multiAnnotationParams$ebnf$1", "multiAnnotationParams$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  {
                    "name": "multiAnnotationParams",
                    "symbols": ["annotationParam", "multiAnnotationParams$ebnf$1"],
                    "postprocess": (d) => extend([d[0], ...d[1].flatMap(([, param]) => param)])
                  },
                  { "name": "annotationParam$subexpression$1", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME, "assignment"] },
                  { "name": "annotationParam", "symbols": ["annotationParam$subexpression$1"], "postprocess": (d) => ({ [d[0][0].value]: d[0][1].value }) },
                  { "name": "annotationParam$subexpression$2", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME] },
                  { "name": "annotationParam", "symbols": ["annotationParam$subexpression$2"], "postprocess": noop },
                  { "name": "at", "symbols": [{ "literal": "@" }], "postprocess": noop },
                  { "name": "constType$subexpression$1", "symbols": ["constKeyword", "numericType", "fieldName", "floatAssignment", "simple"] },
                  { "name": "constType$subexpression$1", "symbols": ["constKeyword", "numericType", "fieldName", "intAssignment", "simple"] },
                  { "name": "constType$subexpression$1", "symbols": ["constKeyword", "stringType", "fieldName", "stringAssignment", "simple"] },
                  { "name": "constType$subexpression$1", "symbols": ["constKeyword", "booleanType", "fieldName", "booleanAssignment", "simple"] },
                  { "name": "constType", "symbols": ["constType$subexpression$1"], "postprocess": (d) => {
                    const def = extend(d[0]);
                    const name = def.name;
                    const value = def.value;
                    return def;
                  } },
                  { "name": "constKeyword", "symbols": [{ "literal": "const" }], "postprocess": (d) => ({ isConstant: true }) },
                  { "name": "fieldName", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME], "postprocess": (d) => ({ name: d[0].value }) },
                  { "name": "sequenceType$ebnf$1$subexpression$1$subexpression$1", "symbols": ["INT"] },
                  { "name": "sequenceType$ebnf$1$subexpression$1$subexpression$1", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME] },
                  { "name": "sequenceType$ebnf$1$subexpression$1", "symbols": [{ "literal": "," }, "sequenceType$ebnf$1$subexpression$1$subexpression$1"] },
                  { "name": "sequenceType$ebnf$1", "symbols": ["sequenceType$ebnf$1$subexpression$1"], "postprocess": id },
                  { "name": "sequenceType$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "sequenceType", "symbols": [{ "literal": "sequence" }, { "literal": "<" }, "allTypes", "sequenceType$ebnf$1", { "literal": ">" }], "postprocess": (d) => {
                    const arrayUpperBound = d[3] !== null ? getIntOrConstantValue(d[3][1][0]) : void 0;
                    const typeObj = d[2];
                    return {
                      ...typeObj,
                      isArray: true,
                      arrayUpperBound
                    };
                  } },
                  { "name": "arrayLength$subexpression$1", "symbols": ["INT"] },
                  { "name": "arrayLength$subexpression$1", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME] },
                  {
                    "name": "arrayLength",
                    "symbols": [{ "literal": "[" }, "arrayLength$subexpression$1", { "literal": "]" }],
                    "postprocess": ([, intOrName]) => ({ isArray: true, arrayLength: getIntOrConstantValue(intOrName ? intOrName[0] : void 0) })
                  },
                  { "name": "assignment$subexpression$1", "symbols": ["floatAssignment"] },
                  { "name": "assignment$subexpression$1", "symbols": ["intAssignment"] },
                  { "name": "assignment$subexpression$1", "symbols": ["stringAssignment"] },
                  { "name": "assignment$subexpression$1", "symbols": ["booleanAssignment"] },
                  { "name": "assignment$subexpression$1", "symbols": ["variableAssignment"] },
                  { "name": "assignment", "symbols": ["assignment$subexpression$1"], "postprocess": (d) => d[0][0] },
                  { "name": "floatAssignment$subexpression$1", "symbols": ["SIGNED_FLOAT"] },
                  { "name": "floatAssignment$subexpression$1", "symbols": ["FLOAT"] },
                  { "name": "floatAssignment", "symbols": [lexer.has("EQ") ? { type: "EQ" } : EQ, "floatAssignment$subexpression$1"], "postprocess": ([, num]) => ({ valueText: num[0], value: parseFloat(num[0]) }) },
                  { "name": "intAssignment$subexpression$1", "symbols": ["SIGNED_INT"] },
                  { "name": "intAssignment$subexpression$1", "symbols": ["INT"] },
                  { "name": "intAssignment", "symbols": [lexer.has("EQ") ? { type: "EQ" } : EQ, "intAssignment$subexpression$1"], "postprocess": ([, num]) => ({ valueText: num[0], value: parseInt(num[0]) }) },
                  { "name": "stringAssignment", "symbols": [lexer.has("EQ") ? { type: "EQ" } : EQ, "STR"], "postprocess": ([, str]) => ({ valueText: str, value: str }) },
                  { "name": "booleanAssignment", "symbols": [lexer.has("EQ") ? { type: "EQ" } : EQ, "BOOLEAN"], "postprocess": ([, bool]) => ({ valueText: bool, value: bool === "TRUE" }) },
                  { "name": "variableAssignment", "symbols": [lexer.has("EQ") ? { type: "EQ" } : EQ, lexer.has("NAME") ? { type: "NAME" } : NAME], "postprocess": ([, name]) => ({ valueText: name.value, value: { usesConstant: true, name: name.value } }) },
                  { "name": "allTypes$subexpression$1", "symbols": ["primitiveTypes"] },
                  { "name": "allTypes$subexpression$1", "symbols": ["customType"] },
                  { "name": "allTypes", "symbols": ["allTypes$subexpression$1"], "postprocess": (d) => d[0][0] },
                  { "name": "primitiveTypes$subexpression$1", "symbols": ["stringType"] },
                  { "name": "primitiveTypes$subexpression$1", "symbols": ["numericType"] },
                  { "name": "primitiveTypes$subexpression$1", "symbols": ["booleanType"] },
                  { "name": "primitiveTypes", "symbols": ["primitiveTypes$subexpression$1"], "postprocess": (d) => ({ ...d[0][0], isComplex: false }) },
                  { "name": "customType", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME], "postprocess": (d) => {
                    const typeName = d[0].value;
                    const isDefinitelyComplex = typeName.includes("::");
                    return { type: typeName, isComplex: isDefinitelyComplex };
                  } },
                  { "name": "stringType$subexpression$1", "symbols": [{ "literal": "string" }] },
                  { "name": "stringType$subexpression$1", "symbols": [{ "literal": "wstring" }] },
                  { "name": "stringType$ebnf$1$subexpression$1$subexpression$1", "symbols": ["INT"] },
                  { "name": "stringType$ebnf$1$subexpression$1$subexpression$1", "symbols": [lexer.has("NAME") ? { type: "NAME" } : NAME] },
                  { "name": "stringType$ebnf$1$subexpression$1", "symbols": [{ "literal": "<" }, "stringType$ebnf$1$subexpression$1$subexpression$1", { "literal": ">" }] },
                  { "name": "stringType$ebnf$1", "symbols": ["stringType$ebnf$1$subexpression$1"], "postprocess": id },
                  { "name": "stringType$ebnf$1", "symbols": [], "postprocess": function(d) {
                    return null;
                  } },
                  { "name": "stringType", "symbols": ["stringType$subexpression$1", "stringType$ebnf$1"], "postprocess": (d) => {
                    let strLength = void 0;
                    if (d[1] !== null) {
                      strLength = getIntOrConstantValue(d[1][1] ? d[1][1][0] : void 0);
                    }
                    return { type: "string", upperBound: strLength };
                  } },
                  { "name": "booleanType", "symbols": [{ "literal": "boolean" }], "postprocess": (d) => ({ type: "bool" }) },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "byte" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "octet" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "wchar" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "char" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "long" }, { "literal": "double" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "double" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "float" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint8" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint16" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint32" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "int64" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "uint64" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "unsigned" }, { "literal": "short" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "short" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "unsigned" }, { "literal": "long" }, { "literal": "long" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "long" }, { "literal": "long" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "unsigned" }, { "literal": "long" }] },
                  { "name": "numericType$subexpression$1", "symbols": [{ "literal": "long" }] },
                  {
                    "name": "numericType",
                    "symbols": ["numericType$subexpression$1"],
                    "postprocess": (d) => {
                      const typeString = d[0].map((t) => t?.value).filter((t) => !!t).join(" ");
                      let type = numericTypeMap[typeString];
                      return { type: type ? type : typeString };
                    }
                  },
                  { "name": "BOOLEAN$subexpression$1", "symbols": [{ "literal": "TRUE" }] },
                  { "name": "BOOLEAN$subexpression$1", "symbols": [{ "literal": "FALSE" }] },
                  { "name": "BOOLEAN", "symbols": ["BOOLEAN$subexpression$1"], "postprocess": join2 },
                  { "name": "STR$ebnf$1", "symbols": [lexer.has("STRING") ? { type: "STRING" } : STRING] },
                  { "name": "STR$ebnf$1", "symbols": ["STR$ebnf$1", lexer.has("STRING") ? { type: "STRING" } : STRING], "postprocess": function arrpush(d) {
                    return d[0].concat([d[1]]);
                  } },
                  { "name": "STR", "symbols": ["STR$ebnf$1"], "postprocess": (d) => {
                    return join2(d.flat(1).filter((d2) => d2 !== null));
                  } },
                  { "name": "SIGNED_FLOAT$subexpression$1", "symbols": [{ "literal": "+" }] },
                  { "name": "SIGNED_FLOAT$subexpression$1", "symbols": [{ "literal": "-" }] },
                  { "name": "SIGNED_FLOAT", "symbols": ["SIGNED_FLOAT$subexpression$1", "FLOAT"], "postprocess": join2 },
                  { "name": "FLOAT$subexpression$1", "symbols": [lexer.has("DECIMAL") ? { type: "DECIMAL" } : DECIMAL] },
                  { "name": "FLOAT$subexpression$1", "symbols": [lexer.has("DECIMALEXP") ? { type: "DECIMALEXP" } : DECIMALEXP] },
                  { "name": "FLOAT", "symbols": ["FLOAT$subexpression$1"], "postprocess": join2 },
                  { "name": "FLOAT$subexpression$2", "symbols": [lexer.has("DECIMAL") ? { type: "DECIMAL" } : DECIMAL, { "literal": "d" }] },
                  { "name": "FLOAT", "symbols": ["FLOAT$subexpression$2"], "postprocess": (d) => d[0][0].value },
                  { "name": "FLOAT$subexpression$3", "symbols": ["INT", { "literal": "d" }] },
                  { "name": "FLOAT", "symbols": ["FLOAT$subexpression$3"], "postprocess": (d) => d[0][0] },
                  { "name": "SIGNED_INT$subexpression$1", "symbols": [{ "literal": "+" }] },
                  { "name": "SIGNED_INT$subexpression$1", "symbols": [{ "literal": "-" }] },
                  { "name": "SIGNED_INT", "symbols": ["SIGNED_INT$subexpression$1", "INT"], "postprocess": join2 },
                  { "name": "INT", "symbols": [lexer.has("INTEGER") ? { type: "INTEGER" } : INTEGER], "postprocess": join2 },
                  { "name": "semi", "symbols": [{ "literal": ";" }], "postprocess": noop },
                  { "name": "simple", "symbols": [], "postprocess": () => ({ isComplex: false }) }
                ],
                ParserStart: "main"
              };
              if (typeof module3.exports !== "undefined") {
                module3.exports = grammar;
              } else {
                window.grammar = grammar;
              }
            })();
          })
        ),
        /***/
        654: (
          /***/
          (function(module3) {
            (function(root, factory) {
              if (module3.exports) {
                module3.exports = factory();
              } else {
                root.nearley = factory();
              }
            })(this, function() {
              function Rule(name, symbols, postprocess) {
                this.id = ++Rule.highestId;
                this.name = name;
                this.symbols = symbols;
                this.postprocess = postprocess;
                return this;
              }
              Rule.highestId = 0;
              Rule.prototype.toString = function(withCursorAt) {
                var symbolSequence = typeof withCursorAt === "undefined" ? this.symbols.map(getSymbolShortDisplay).join(" ") : this.symbols.slice(0, withCursorAt).map(getSymbolShortDisplay).join(" ") + " \u25CF " + this.symbols.slice(withCursorAt).map(getSymbolShortDisplay).join(" ");
                return this.name + " \u2192 " + symbolSequence;
              };
              function State(rule, dot, reference, wantedBy) {
                this.rule = rule;
                this.dot = dot;
                this.reference = reference;
                this.data = [];
                this.wantedBy = wantedBy;
                this.isComplete = this.dot === rule.symbols.length;
              }
              State.prototype.toString = function() {
                return "{" + this.rule.toString(this.dot) + "}, from: " + (this.reference || 0);
              };
              State.prototype.nextState = function(child) {
                var state = new State(this.rule, this.dot + 1, this.reference, this.wantedBy);
                state.left = this;
                state.right = child;
                if (state.isComplete) {
                  state.data = state.build();
                  state.right = void 0;
                }
                return state;
              };
              State.prototype.build = function() {
                var children = [];
                var node = this;
                do {
                  children.push(node.right.data);
                  node = node.left;
                } while (node.left);
                children.reverse();
                return children;
              };
              State.prototype.finish = function() {
                if (this.rule.postprocess) {
                  this.data = this.rule.postprocess(this.data, this.reference, Parser.fail);
                }
              };
              function Column(grammar, index) {
                this.grammar = grammar;
                this.index = index;
                this.states = [];
                this.wants = {};
                this.scannable = [];
                this.completed = {};
              }
              Column.prototype.process = function(nextColumn) {
                var states = this.states;
                var wants = this.wants;
                var completed = this.completed;
                for (var w = 0; w < states.length; w++) {
                  var state = states[w];
                  if (state.isComplete) {
                    state.finish();
                    if (state.data !== Parser.fail) {
                      var wantedBy = state.wantedBy;
                      for (var i = wantedBy.length; i--; ) {
                        var left = wantedBy[i];
                        this.complete(left, state);
                      }
                      if (state.reference === this.index) {
                        var exp = state.rule.name;
                        (this.completed[exp] = this.completed[exp] || []).push(state);
                      }
                    }
                  } else {
                    var exp = state.rule.symbols[state.dot];
                    if (typeof exp !== "string") {
                      this.scannable.push(state);
                      continue;
                    }
                    if (wants[exp]) {
                      wants[exp].push(state);
                      if (completed.hasOwnProperty(exp)) {
                        var nulls = completed[exp];
                        for (var i = 0; i < nulls.length; i++) {
                          var right = nulls[i];
                          this.complete(state, right);
                        }
                      }
                    } else {
                      wants[exp] = [state];
                      this.predict(exp);
                    }
                  }
                }
              };
              Column.prototype.predict = function(exp) {
                var rules = this.grammar.byName[exp] || [];
                for (var i = 0; i < rules.length; i++) {
                  var r = rules[i];
                  var wantedBy = this.wants[exp];
                  var s = new State(r, 0, this.index, wantedBy);
                  this.states.push(s);
                }
              };
              Column.prototype.complete = function(left, right) {
                var copy = left.nextState(right);
                this.states.push(copy);
              };
              function Grammar(rules, start) {
                this.rules = rules;
                this.start = start || this.rules[0].name;
                var byName = this.byName = {};
                this.rules.forEach(function(rule) {
                  if (!byName.hasOwnProperty(rule.name)) {
                    byName[rule.name] = [];
                  }
                  byName[rule.name].push(rule);
                });
              }
              Grammar.fromCompiled = function(rules, start) {
                var lexer = rules.Lexer;
                if (rules.ParserStart) {
                  start = rules.ParserStart;
                  rules = rules.ParserRules;
                }
                var rules = rules.map(function(r) {
                  return new Rule(r.name, r.symbols, r.postprocess);
                });
                var g = new Grammar(rules, start);
                g.lexer = lexer;
                return g;
              };
              function StreamLexer() {
                this.reset("");
              }
              StreamLexer.prototype.reset = function(data, state) {
                this.buffer = data;
                this.index = 0;
                this.line = state ? state.line : 1;
                this.lastLineBreak = state ? -state.col : 0;
              };
              StreamLexer.prototype.next = function() {
                if (this.index < this.buffer.length) {
                  var ch = this.buffer[this.index++];
                  if (ch === "\n") {
                    this.line += 1;
                    this.lastLineBreak = this.index;
                  }
                  return { value: ch };
                }
              };
              StreamLexer.prototype.save = function() {
                return {
                  line: this.line,
                  col: this.index - this.lastLineBreak
                };
              };
              StreamLexer.prototype.formatError = function(token, message) {
                var buffer = this.buffer;
                if (typeof buffer === "string") {
                  var lines = buffer.split("\n").slice(
                    Math.max(0, this.line - 5),
                    this.line
                  );
                  var nextLineBreak = buffer.indexOf("\n", this.index);
                  if (nextLineBreak === -1) nextLineBreak = buffer.length;
                  var col = this.index - this.lastLineBreak;
                  var lastLineDigits = String(this.line).length;
                  message += " at line " + this.line + " col " + col + ":\n\n";
                  message += lines.map(function(line, i) {
                    return pad(this.line - lines.length + i + 1, lastLineDigits) + " " + line;
                  }, this).join("\n");
                  message += "\n" + pad("", lastLineDigits + col) + "^\n";
                  return message;
                } else {
                  return message + " at index " + (this.index - 1);
                }
                function pad(n, length) {
                  var s = String(n);
                  return Array(length - s.length + 1).join(" ") + s;
                }
              };
              function Parser(rules, start, options) {
                if (rules instanceof Grammar) {
                  var grammar = rules;
                  var options = start;
                } else {
                  var grammar = Grammar.fromCompiled(rules, start);
                }
                this.grammar = grammar;
                this.options = {
                  keepHistory: false,
                  lexer: grammar.lexer || new StreamLexer()
                };
                for (var key in options || {}) {
                  this.options[key] = options[key];
                }
                this.lexer = this.options.lexer;
                this.lexerState = void 0;
                var column = new Column(grammar, 0);
                var table = this.table = [column];
                column.wants[grammar.start] = [];
                column.predict(grammar.start);
                column.process();
                this.current = 0;
              }
              Parser.fail = {};
              Parser.prototype.feed = function(chunk) {
                var lexer = this.lexer;
                lexer.reset(chunk, this.lexerState);
                var token;
                while (true) {
                  try {
                    token = lexer.next();
                    if (!token) {
                      break;
                    }
                  } catch (e) {
                    var nextColumn = new Column(this.grammar, this.current + 1);
                    this.table.push(nextColumn);
                    var err2 = new Error(this.reportLexerError(e));
                    err2.offset = this.current;
                    err2.token = e.token;
                    throw err2;
                  }
                  var column = this.table[this.current];
                  if (!this.options.keepHistory) {
                    delete this.table[this.current - 1];
                  }
                  var n = this.current + 1;
                  var nextColumn = new Column(this.grammar, n);
                  this.table.push(nextColumn);
                  var literal = token.text !== void 0 ? token.text : token.value;
                  var value = lexer.constructor === StreamLexer ? token.value : token;
                  var scannable = column.scannable;
                  for (var w = scannable.length; w--; ) {
                    var state = scannable[w];
                    var expect = state.rule.symbols[state.dot];
                    if (expect.test ? expect.test(value) : expect.type ? expect.type === token.type : expect.literal === literal) {
                      var next = state.nextState({ data: value, token, isToken: true, reference: n - 1 });
                      nextColumn.states.push(next);
                    }
                  }
                  nextColumn.process();
                  if (nextColumn.states.length === 0) {
                    var err2 = new Error(this.reportError(token));
                    err2.offset = this.current;
                    err2.token = token;
                    throw err2;
                  }
                  if (this.options.keepHistory) {
                    column.lexerState = lexer.save();
                  }
                  this.current++;
                }
                if (column) {
                  this.lexerState = lexer.save();
                }
                this.results = this.finish();
                return this;
              };
              Parser.prototype.reportLexerError = function(lexerError) {
                var tokenDisplay, lexerMessage;
                var token = lexerError.token;
                if (token) {
                  tokenDisplay = "input " + JSON.stringify(token.text[0]) + " (lexer error)";
                  lexerMessage = this.lexer.formatError(token, "Syntax error");
                } else {
                  tokenDisplay = "input (lexer error)";
                  lexerMessage = lexerError.message;
                }
                return this.reportErrorCommon(lexerMessage, tokenDisplay);
              };
              Parser.prototype.reportError = function(token) {
                var tokenDisplay = (token.type ? token.type + " token: " : "") + JSON.stringify(token.value !== void 0 ? token.value : token);
                var lexerMessage = this.lexer.formatError(token, "Syntax error");
                return this.reportErrorCommon(lexerMessage, tokenDisplay);
              };
              Parser.prototype.reportErrorCommon = function(lexerMessage, tokenDisplay) {
                var lines = [];
                lines.push(lexerMessage);
                var lastColumnIndex = this.table.length - 2;
                var lastColumn = this.table[lastColumnIndex];
                var expectantStates = lastColumn.states.filter(function(state) {
                  var nextSymbol = state.rule.symbols[state.dot];
                  return nextSymbol && typeof nextSymbol !== "string";
                });
                if (expectantStates.length === 0) {
                  lines.push("Unexpected " + tokenDisplay + ". I did not expect any more input. Here is the state of my parse table:\n");
                  this.displayStateStack(lastColumn.states, lines);
                } else {
                  lines.push("Unexpected " + tokenDisplay + ". Instead, I was expecting to see one of the following:\n");
                  var stateStacks = expectantStates.map(function(state) {
                    return this.buildFirstStateStack(state, []) || [state];
                  }, this);
                  stateStacks.forEach(function(stateStack) {
                    var state = stateStack[0];
                    var nextSymbol = state.rule.symbols[state.dot];
                    var symbolDisplay = this.getSymbolDisplay(nextSymbol);
                    lines.push("A " + symbolDisplay + " based on:");
                    this.displayStateStack(stateStack, lines);
                  }, this);
                }
                lines.push("");
                return lines.join("\n");
              };
              Parser.prototype.displayStateStack = function(stateStack, lines) {
                var lastDisplay;
                var sameDisplayCount = 0;
                for (var j = 0; j < stateStack.length; j++) {
                  var state = stateStack[j];
                  var display = state.rule.toString(state.dot);
                  if (display === lastDisplay) {
                    sameDisplayCount++;
                  } else {
                    if (sameDisplayCount > 0) {
                      lines.push("    ^ " + sameDisplayCount + " more lines identical to this");
                    }
                    sameDisplayCount = 0;
                    lines.push("    " + display);
                  }
                  lastDisplay = display;
                }
              };
              Parser.prototype.getSymbolDisplay = function(symbol) {
                return getSymbolLongDisplay(symbol);
              };
              Parser.prototype.buildFirstStateStack = function(state, visited) {
                if (visited.indexOf(state) !== -1) {
                  return null;
                }
                if (state.wantedBy.length === 0) {
                  return [state];
                }
                var prevState = state.wantedBy[0];
                var childVisited = [state].concat(visited);
                var childResult = this.buildFirstStateStack(prevState, childVisited);
                if (childResult === null) {
                  return null;
                }
                return [state].concat(childResult);
              };
              Parser.prototype.save = function() {
                var column = this.table[this.current];
                column.lexerState = this.lexerState;
                return column;
              };
              Parser.prototype.restore = function(column) {
                var index = column.index;
                this.current = index;
                this.table[index] = column;
                this.table.splice(index + 1);
                this.lexerState = column.lexerState;
                this.results = this.finish();
              };
              Parser.prototype.rewind = function(index) {
                if (!this.options.keepHistory) {
                  throw new Error("set option `keepHistory` to enable rewinding");
                }
                this.restore(this.table[index]);
              };
              Parser.prototype.finish = function() {
                var considerations = [];
                var start = this.grammar.start;
                var column = this.table[this.table.length - 1];
                column.states.forEach(function(t) {
                  if (t.rule.name === start && t.dot === t.rule.symbols.length && t.reference === 0 && t.data !== Parser.fail) {
                    considerations.push(t);
                  }
                });
                return considerations.map(function(c) {
                  return c.data;
                });
              };
              function getSymbolLongDisplay(symbol) {
                var type = typeof symbol;
                if (type === "string") {
                  return symbol;
                } else if (type === "object") {
                  if (symbol.literal) {
                    return JSON.stringify(symbol.literal);
                  } else if (symbol instanceof RegExp) {
                    return "character matching " + symbol;
                  } else if (symbol.type) {
                    return symbol.type + " token";
                  } else if (symbol.test) {
                    return "token matching " + String(symbol.test);
                  } else {
                    throw new Error("Unknown symbol type: " + symbol);
                  }
                }
              }
              function getSymbolShortDisplay(symbol) {
                var type = typeof symbol;
                if (type === "string") {
                  return symbol;
                } else if (type === "object") {
                  if (symbol.literal) {
                    return JSON.stringify(symbol.literal);
                  } else if (symbol instanceof RegExp) {
                    return symbol.toString();
                  } else if (symbol.type) {
                    return "%" + symbol.type;
                  } else if (symbol.test) {
                    return "<" + String(symbol.test) + ">";
                  } else {
                    throw new Error("Unknown symbol type: " + symbol);
                  }
                }
              }
              return {
                Parser,
                Grammar,
                Rule
              };
            });
          })
        ),
        /***/
        515: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.buildRos2Type = void 0;
            const TYPE = String.raw`(?<type>[a-zA-Z0-9_/]+)`;
            const STRING_BOUND = String.raw`(?:<=(?<stringBound>\d+))`;
            const ARRAY_BOUND = String.raw`(?:(?<unboundedArray>\[\])|\[(?<arrayLength>\d+)\]|\[<=(?<arrayBound>\d+)\])`;
            const NAME2 = String.raw`(?<name>[a-zA-Z0-9_]+)`;
            const QUOTED_STRING = String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"`;
            const COMMENT_TERMINATED_LITERAL = String.raw`(?:${QUOTED_STRING}|(?:\\.|[^\s'"#\\])(?:\\.|[^#\\])*)`;
            const ARRAY_TERMINATED_LITERAL = String.raw`(?:${QUOTED_STRING}|(?:\\.|[^\s'"\],#\\])(?:\\.|[^\],#\\])*)`;
            const CONSTANT_ASSIGNMENT = String.raw`\s*=\s*(?<constantValue>${COMMENT_TERMINATED_LITERAL}?)`;
            const DEFAULT_VALUE_ARRAY = String.raw`\[(?:${ARRAY_TERMINATED_LITERAL},)*${ARRAY_TERMINATED_LITERAL}?\]`;
            const DEFAULT_VALUE = String.raw`(?<defaultValue>${DEFAULT_VALUE_ARRAY}|${COMMENT_TERMINATED_LITERAL})`;
            const COMMENT = String.raw`(?:#.*)`;
            const DEFINITION_LINE_REGEX = new RegExp(String.raw`^${TYPE}${STRING_BOUND}?${ARRAY_BOUND}?\s+${NAME2}(?:${CONSTANT_ASSIGNMENT}|\s+${DEFAULT_VALUE})?\s*${COMMENT}?$`);
            const STRING_ESCAPES = String.raw`\\(?<char>['"abfnrtv\\])|\\(?<oct>[0-7]{1,3})|\\x(?<hex2>[a-fA-F0-9]{2})|\\u(?<hex4>[a-fA-F0-9]{4})|\\U(?<hex8>[a-fA-F0-9]{8})`;
            const BUILTIN_TYPES = [
              "bool",
              "byte",
              "char",
              "float32",
              "float64",
              "int8",
              "uint8",
              "int16",
              "uint16",
              "int32",
              "uint32",
              "int64",
              "uint64",
              "string",
              "wstring",
              "time",
              "duration",
              "builtin_interfaces/Time",
              "builtin_interfaces/Duration",
              "builtin_interfaces/msg/Time",
              "builtin_interfaces/msg/Duration"
            ];
            function parseBigIntLiteral(str, min, max) {
              const value = BigInt(str);
              if (value < min || value > max) {
                throw new Error(`Number ${str} out of range [${min}, ${max}]`);
              }
              return value;
            }
            function parseNumberLiteral(str, min, max) {
              const value = parseInt(str);
              if (Number.isNaN(value)) {
                throw new Error(`Invalid numeric literal: ${str}`);
              }
              if (value < min || value > max) {
                throw new Error(`Number ${str} out of range [${min}, ${max}]`);
              }
              return value;
            }
            const LITERAL_REGEX = new RegExp(ARRAY_TERMINATED_LITERAL, "y");
            const COMMA_OR_END_REGEX = /\s*(,)\s*|\s*$/y;
            function parseArrayLiteral(type, rawStr) {
              if (!rawStr.startsWith("[") || !rawStr.endsWith("]")) {
                throw new Error("Array must start with [ and end with ]");
              }
              const str = rawStr.substring(1, rawStr.length - 1);
              if (type === "string" || type === "wstring") {
                const results = [];
                let offset = 0;
                while (offset < str.length) {
                  if (str[offset] === ",") {
                    throw new Error("Expected array element before comma");
                  }
                  LITERAL_REGEX.lastIndex = offset;
                  let match = LITERAL_REGEX.exec(str);
                  if (match) {
                    results.push(parseStringLiteral(match[0]));
                    offset = LITERAL_REGEX.lastIndex;
                  }
                  COMMA_OR_END_REGEX.lastIndex = offset;
                  match = COMMA_OR_END_REGEX.exec(str);
                  if (!match) {
                    throw new Error("Expected comma or end of array");
                  }
                  if (!match[1]) {
                    break;
                  }
                  offset = COMMA_OR_END_REGEX.lastIndex;
                }
                return results;
              }
              return str.split(",").map((part) => parsePrimitiveLiteral(type, part.trim()));
            }
            function parseStringLiteral(maybeQuotedStr) {
              let quoteThatMustBeEscaped = "";
              let str = maybeQuotedStr;
              for (const quote of ["'", '"']) {
                if (maybeQuotedStr.startsWith(quote)) {
                  if (!maybeQuotedStr.endsWith(quote)) {
                    throw new Error(`Expected terminating ${quote} in string literal: ${maybeQuotedStr}`);
                  }
                  quoteThatMustBeEscaped = quote;
                  str = maybeQuotedStr.substring(quote.length, maybeQuotedStr.length - quote.length);
                  break;
                }
              }
              if (!new RegExp(String.raw`^(?:[^\\${quoteThatMustBeEscaped}]|${STRING_ESCAPES})*$`).test(str) == void 0) {
                throw new Error(`Invalid string literal: ${str}`);
              }
              return str.replace(new RegExp(STRING_ESCAPES, "g"), (...args) => {
                const { char, oct, hex2, hex4, hex8 } = args[args.length - 1];
                const hex = hex2 ?? hex4 ?? hex8;
                if (char != void 0) {
                  return {
                    "'": "'",
                    '"': '"',
                    a: "\x07",
                    b: "\b",
                    f: "\f",
                    n: "\n",
                    r: "\r",
                    t: "	",
                    v: "\v",
                    "\\": "\\"
                  }[char];
                } else if (oct != void 0) {
                  return String.fromCodePoint(parseInt(oct, 8));
                } else if (hex != void 0) {
                  return String.fromCodePoint(parseInt(hex, 16));
                } else {
                  throw new Error("Expected exactly one matched group");
                }
              });
            }
            function parsePrimitiveLiteral(type, str) {
              switch (type) {
                case "bool":
                  if (["true", "True", "1"].includes(str)) {
                    return true;
                  } else if (["false", "False", "0"].includes(str)) {
                    return false;
                  }
                  break;
                case "float32":
                case "float64": {
                  const value = parseFloat(str);
                  if (!Number.isNaN(value)) {
                    return value;
                  }
                  break;
                }
                case "int8":
                  return parseNumberLiteral(str, ~127, 127);
                case "uint8":
                  return parseNumberLiteral(str, 0, 255);
                case "int16":
                  return parseNumberLiteral(str, ~32767, 32767);
                case "uint16":
                  return parseNumberLiteral(str, 0, 65535);
                case "int32":
                  return parseNumberLiteral(str, ~2147483647, 2147483647);
                case "uint32":
                  return parseNumberLiteral(str, 0, 4294967295);
                case "int64":
                  return parseBigIntLiteral(str, ~0x7fffffffffffffffn, 0x7fffffffffffffffn);
                case "uint64":
                  return parseBigIntLiteral(str, 0n, 0xffffffffffffffffn);
                case "string":
                case "wstring":
                  return parseStringLiteral(str);
              }
              throw new Error(`Invalid literal of type ${type}: ${str}`);
            }
            function normalizeType2(type) {
              switch (type) {
                case "char":
                  return "uint8";
                case "byte":
                  return "int8";
                case "builtin_interfaces/Time":
                case "builtin_interfaces/msg/Time":
                  return "time";
                case "builtin_interfaces/Duration":
                case "builtin_interfaces/msg/Duration":
                  return "duration";
              }
              return type;
            }
            function buildRos2Type(lines) {
              const definitions = [];
              let complexTypeName;
              for (const { line } of lines) {
                let match;
                if (line.startsWith("#")) {
                  continue;
                } else if (match = /^MSG: ([^ ]+)\s*(?:#.+)?$/.exec(line)) {
                  complexTypeName = match[1];
                  continue;
                } else if (match = DEFINITION_LINE_REGEX.exec(line)) {
                  const { type: rawType, stringBound, unboundedArray, arrayLength, arrayBound, name, constantValue, defaultValue } = match.groups;
                  const type = normalizeType2(rawType);
                  if (stringBound != void 0 && type !== "string" && type !== "wstring") {
                    throw new Error(`Invalid string bound for type ${type}`);
                  }
                  if (constantValue != void 0) {
                    if (!/^[A-Z](?:_?[A-Z0-9]+)*$/.test(name)) {
                      throw new Error(`Invalid constant name: ${name}`);
                    }
                  } else {
                    if (!/^[a-z](?:_?[a-z0-9]+)*$/.test(name)) {
                      throw new Error(`Invalid field name: ${name}`);
                    }
                  }
                  const isComplex = !BUILTIN_TYPES.includes(type);
                  const isArray = unboundedArray != void 0 || arrayLength != void 0 || arrayBound != void 0;
                  definitions.push({
                    name,
                    type,
                    isComplex: constantValue != void 0 ? isComplex || void 0 : isComplex,
                    isConstant: constantValue != void 0 || void 0,
                    isArray: constantValue != void 0 ? isArray || void 0 : isArray,
                    arrayLength: arrayLength != void 0 ? parseInt(arrayLength) : void 0,
                    arrayUpperBound: arrayBound != void 0 ? parseInt(arrayBound) : void 0,
                    upperBound: stringBound != void 0 ? parseInt(stringBound) : void 0,
                    defaultValue: defaultValue != void 0 ? isArray ? parseArrayLiteral(type, defaultValue.trim()) : parsePrimitiveLiteral(type, defaultValue.trim()) : void 0,
                    value: constantValue != void 0 ? parsePrimitiveLiteral(type, constantValue.trim()) : void 0,
                    valueText: constantValue?.trim()
                  });
                } else {
                  throw new Error(`Could not parse line: '${line}'`);
                }
              }
              return { name: complexTypeName, definitions };
            }
            exports3.buildRos2Type = buildRos2Type;
          })
        ),
        /***/
        715: (
          /***/
          (function(__unused_webpack_module, exports3, __webpack_require__2) {
            "use strict";
            var __createBinding = this && this.__createBinding || (Object.create ? (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              var desc = Object.getOwnPropertyDescriptor(m, k);
              if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
                desc = { enumerable: true, get: function() {
                  return m[k];
                } };
              }
              Object.defineProperty(o, k2, desc);
            }) : (function(o, m, k, k2) {
              if (k2 === void 0) k2 = k;
              o[k2] = m[k];
            }));
            var __exportStar = this && this.__exportStar || function(m, exports4) {
              for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports4, p)) __createBinding(exports4, m, p);
            };
            Object.defineProperty(exports3, "__esModule", { value: true });
            __exportStar(__webpack_require__2(322), exports3);
            __exportStar(__webpack_require__2(867), exports3);
            __exportStar(__webpack_require__2(733), exports3);
            __exportStar(__webpack_require__2(210), exports3);
          })
        ),
        /***/
        322: (
          /***/
          ((__unused_webpack_module, exports3, __webpack_require__2) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.md5 = void 0;
            const md5_typescript_1 = __webpack_require__2(417);
            const BUILTIN_TYPES = /* @__PURE__ */ new Set([
              "int8",
              "uint8",
              "int16",
              "uint16",
              "int32",
              "uint32",
              "int64",
              "uint64",
              "float32",
              "float64",
              "string",
              "bool",
              "char",
              "byte",
              "time",
              "duration"
            ]);
            function md5(msgDefs) {
              if (msgDefs.length === 0) {
                throw new Error(`Cannot produce md5sum for empty msgDefs`);
              }
              const subMsgDefs = /* @__PURE__ */ new Map();
              for (const msgDef of msgDefs) {
                if (msgDef.name != void 0) {
                  subMsgDefs.set(msgDef.name, msgDef);
                }
              }
              const first = msgDefs[0];
              return computeMessageMd5(first, subMsgDefs);
            }
            exports3.md5 = md5;
            function computeMessageMd5(msgDef, subMsgDefs) {
              let output = "";
              const constants = msgDef.definitions.filter(({ isConstant }) => isConstant);
              const variables = msgDef.definitions.filter(({ isConstant }) => isConstant == void 0 || !isConstant);
              for (const def of constants) {
                output += `${def.type} ${def.name}=${def.valueText ?? String(def.value)}
`;
              }
              for (const def of variables) {
                if (isBuiltin(def.type)) {
                  const arrayLength = def.arrayLength != void 0 ? String(def.arrayLength) : "";
                  const array = def.isArray === true ? `[${arrayLength}]` : "";
                  output += `${def.type}${array} ${def.name}
`;
                } else {
                  const subMsgDef = subMsgDefs.get(def.type);
                  if (subMsgDef == void 0) {
                    throw new Error(`Missing definition for submessage type "${def.type}"`);
                  }
                  const subMd5 = computeMessageMd5(subMsgDef, subMsgDefs);
                  output += `${subMd5} ${def.name}
`;
                }
              }
              output = output.trimEnd();
              return md5_typescript_1.Md5.init(output);
            }
            function isBuiltin(typeName) {
              return BUILTIN_TYPES.has(typeName);
            }
          })
        ),
        /***/
        867: (
          /***/
          (function(__unused_webpack_module, exports3, __webpack_require__2) {
            "use strict";
            var __importDefault = this && this.__importDefault || function(mod) {
              return mod && mod.__esModule ? mod : { "default": mod };
            };
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.normalizeType = exports3.fixupTypes = exports3.parse = exports3.ROS2IDL_GRAMMAR = void 0;
            const nearley_1 = __webpack_require__2(654);
            const buildRos2Type_1 = __webpack_require__2(515);
            const ros1_ne_1 = __importDefault(__webpack_require__2(558));
            const ros2idl_ne_1 = __importDefault(__webpack_require__2(568));
            const ROS1_GRAMMAR = nearley_1.Grammar.fromCompiled(ros1_ne_1.default);
            exports3.ROS2IDL_GRAMMAR = nearley_1.Grammar.fromCompiled(ros2idl_ne_1.default);
            function parse(messageDefinition, options = {}) {
              const allLines = messageDefinition.split("\n").map((line) => line.trim()).filter((line) => line);
              let definitionLines = [];
              const types2 = [];
              allLines.forEach((line) => {
                if (line.startsWith("#")) {
                  return;
                }
                if (line.startsWith("==")) {
                  types2.push(options.ros2 === true ? (0, buildRos2Type_1.buildRos2Type)(definitionLines) : buildType(definitionLines, ROS1_GRAMMAR));
                  definitionLines = [];
                } else {
                  definitionLines.push({ line });
                }
              });
              types2.push(options.ros2 === true ? (0, buildRos2Type_1.buildRos2Type)(definitionLines) : buildType(definitionLines, ROS1_GRAMMAR));
              if (options.skipTypeFixup !== true) {
                fixupTypes(types2);
              }
              return types2;
            }
            exports3.parse = parse;
            function fixupTypes(types2) {
              types2.forEach(({ definitions }) => {
                definitions.forEach((definition) => {
                  if (definition.isComplex === true) {
                    const foundName = findTypeByName2(types2, definition.type).name;
                    if (foundName == void 0) {
                      throw new Error(`Missing type definition for ${definition.type}`);
                    }
                    definition.type = foundName;
                  }
                });
              });
            }
            exports3.fixupTypes = fixupTypes;
            function buildType(lines, grammar) {
              const definitions = [];
              let complexTypeName;
              lines.forEach(({ line }) => {
                if (line.startsWith("MSG:")) {
                  const [_, name] = simpleTokenization(line);
                  complexTypeName = name?.trim();
                  return;
                }
                const parser = new nearley_1.Parser(grammar);
                parser.feed(line);
                const results = parser.finish();
                if (results.length === 0) {
                  throw new Error(`Could not parse line: '${line}'`);
                } else if (results.length > 1) {
                  throw new Error(`Ambiguous line: '${line}'`);
                }
                const result = results[0];
                if (result != void 0) {
                  result.type = normalizeType2(result.type);
                  definitions.push(result);
                }
              });
              return { name: complexTypeName, definitions };
            }
            function simpleTokenization(line) {
              return line.replace(/#.*/gi, "").split(" ").filter((word) => word);
            }
            function findTypeByName2(types2, name) {
              const matches = types2.filter((type) => {
                const typeName = type.name ?? "";
                if (name.length === 0) {
                  return typeName.length === 0;
                }
                const nameEnd = name.includes("/") ? name : `/${name}`;
                return typeName.endsWith(nameEnd);
              });
              if (matches[0] == void 0) {
                throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}`);
              }
              return matches[0];
            }
            function normalizeType2(type) {
              if (type === "char") {
                return "uint8";
              } else if (type === "byte") {
                return "int8";
              }
              return type;
            }
            exports3.normalizeType = normalizeType2;
          })
        ),
        /***/
        733: (
          /***/
          ((__unused_webpack_module, exports3, __webpack_require__2) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.parseRos2idl = void 0;
            const nearley_1 = __webpack_require__2(654);
            const parse_1 = __webpack_require__2(867);
            function parseRos2idl(messageDefinition) {
              return buildRos2idlType(messageDefinition, parse_1.ROS2IDL_GRAMMAR);
            }
            exports3.parseRos2idl = parseRos2idl;
            function buildRos2idlType(messageDefinition, grammar) {
              const parser = new nearley_1.Parser(grammar);
              parser.feed(messageDefinition);
              const results = parser.finish();
              if (results.length === 0) {
                throw new Error(`Could not parse message definition (unexpected end of input): '${messageDefinition}'`);
              }
              const result = results[0];
              const processedResult = postProcessIdlDefinitions(result);
              for (const { definitions } of processedResult) {
                for (const definition of definitions) {
                  definition.type = (0, parse_1.normalizeType)(definition.type);
                }
              }
              return processedResult;
            }
            function traverseIdl(path, processNode) {
              const currNode = path[path.length - 1];
              const children = currNode.definitions;
              if (children) {
                children.forEach((n) => traverseIdl([...path, n], processNode));
              }
              processNode(path);
            }
            function postProcessIdlDefinitions(definitions) {
              const finalDefs = [];
              for (const definition of definitions) {
                const typedefMap = /* @__PURE__ */ new Map();
                const constantValueMap = /* @__PURE__ */ new Map();
                traverseIdl([definition], (path) => {
                  const node = path[path.length - 1];
                  if (node.definitionType === "typedef") {
                    const { definitionType: _definitionType, name: _name, ...partialDef } = node;
                    typedefMap.set(node.name, partialDef);
                  } else if (node.isConstant === true) {
                    constantValueMap.set(node.name, node.value);
                  }
                });
                traverseIdl([definition], (path) => {
                  const node = path[path.length - 1];
                  if (node.definitions != void 0) {
                    return;
                  }
                  if (node.type && typedefMap.has(node.type)) {
                    Object.assign(node, { ...typedefMap.get(node.type), name: node.name });
                  }
                  for (const [key, constantName] of node.constantUsage ?? []) {
                    if (constantValueMap.has(constantName)) {
                      node[key] = constantValueMap.get(constantName);
                    } else {
                      throw new Error(`Could not find constant <${constantName}> for field <${node.name ?? "undefined"}> in <${definition.name}>`);
                    }
                  }
                  delete node.constantUsage;
                  if (node.type != void 0) {
                    node.type = node.type.replace(/::/g, "/");
                  }
                });
                const flattened = flattenIdlNamespaces(definition);
                finalDefs.push(...flattened);
              }
              return finalDefs;
            }
            function flattenIdlNamespaces(definition) {
              const flattened = [];
              traverseIdl([definition], (path) => {
                const node = path[path.length - 1];
                if (node.definitionType === "module") {
                  const moduleDefs = node.definitions.filter((d) => d.definitionType !== "typedef");
                  if (moduleDefs.every((child) => child.isConstant)) {
                    flattened.push({
                      name: path.map((n) => n.name).join("/"),
                      definitions: moduleDefs
                    });
                  }
                } else if (node.definitionType === "struct") {
                  flattened.push({
                    name: path.map((n) => n.name).join("/"),
                    definitions: node.definitions
                  });
                }
              });
              return flattened;
            }
          })
        ),
        /***/
        210: (
          /***/
          ((__unused_webpack_module, exports3) => {
            "use strict";
            Object.defineProperty(exports3, "__esModule", { value: true });
            exports3.stringify = void 0;
            function stringify(msgDefs) {
              let output = "";
              for (let i = 0; i < msgDefs.length; i++) {
                const msgDef = msgDefs[i];
                const constants = msgDef.definitions.filter(({ isConstant }) => isConstant);
                const variables = msgDef.definitions.filter(({ isConstant }) => isConstant == void 0 || !isConstant);
                if (i > 0) {
                  output += "\n================================================================================\n";
                  output += `MSG: ${msgDef.name ?? ""}
`;
                }
                for (const def of constants) {
                  output += `${def.type} ${def.name} = ${def.valueText ?? String(def.value)}
`;
                }
                if (variables.length > 0) {
                  if (output.length > 0) {
                    output += "\n";
                  }
                  for (const def of variables) {
                    const upperBound = def.upperBound != void 0 ? `<=${def.upperBound}` : "";
                    const arrayLength = def.arrayLength != void 0 ? String(def.arrayLength) : def.arrayUpperBound != void 0 ? `<=${def.arrayUpperBound}` : "";
                    const array = def.isArray === true ? `[${arrayLength}]` : "";
                    const defaultValue = def.defaultValue != void 0 ? ` ${stringifyDefaultValue(def.defaultValue)}` : "";
                    output += `${def.type}${upperBound}${array} ${def.name}${defaultValue}
`;
                  }
                }
              }
              return output.trimEnd();
            }
            exports3.stringify = stringify;
            function stringifyDefaultValue(value) {
              if (Array.isArray(value)) {
                return `[${value.map((x) => typeof x === "bigint" ? x.toString() : JSON.stringify(x)).join(", ")}]`;
              }
              return typeof value === "bigint" ? value.toString() : JSON.stringify(value);
            }
          })
        )
        /******/
      };
      var __webpack_module_cache__ = {};
      function __webpack_require__(moduleId) {
        var cachedModule = __webpack_module_cache__[moduleId];
        if (cachedModule !== void 0) {
          return cachedModule.exports;
        }
        var module3 = __webpack_module_cache__[moduleId] = {
          /******/
          // no module.id needed
          /******/
          // no module.loaded needed
          /******/
          exports: {}
          /******/
        };
        __webpack_modules__[moduleId].call(module3.exports, module3, module3.exports, __webpack_require__);
        return module3.exports;
      }
      (() => {
        __webpack_require__.d = (exports3, definition) => {
          for (var key in definition) {
            if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports3, key)) {
              Object.defineProperty(exports3, key, { enumerable: true, get: definition[key] });
            }
          }
        };
      })();
      (() => {
        __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
      })();
      (() => {
        __webpack_require__.r = (exports3) => {
          if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
            Object.defineProperty(exports3, Symbol.toStringTag, { value: "Module" });
          }
          Object.defineProperty(exports3, "__esModule", { value: true });
        };
      })();
      var __webpack_exports__ = __webpack_require__(715);
      module2.exports = __webpack_exports__;
    })();
  }
});

// node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/Time.js
var require_Time = __commonJS({
  "node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/Time.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
  }
});

// node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/timeUtils.js
var require_timeUtils = __commonJS({
  "node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/timeUtils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isTime = isTime;
    exports2.toString = toString;
    exports2.fromString = fromString;
    exports2.toRFC3339String = toRFC3339String;
    exports2.fromRFC3339String = fromRFC3339String;
    exports2.toDate = toDate;
    exports2.fromDate = fromDate;
    exports2.percentOf = percentOf;
    exports2.interpolate = interpolate;
    exports2.fixTime = fixTime;
    exports2.add = add;
    exports2.subtract = subtract;
    exports2.toNanoSec = toNanoSec;
    exports2.toMicroSec = toMicroSec;
    exports2.toSec = toSec;
    exports2.fromSec = fromSec;
    exports2.fromNanoSec = fromNanoSec;
    exports2.toMillis = toMillis;
    exports2.fromMillis = fromMillis;
    exports2.fromMicros = fromMicros;
    exports2.clampTime = clampTime;
    exports2.isTimeInRangeInclusive = isTimeInRangeInclusive;
    exports2.compare = compare;
    exports2.isLessThan = isLessThan;
    exports2.isGreaterThan = isGreaterThan;
    exports2.areEqual = areEqual;
    function isTime(obj) {
      return typeof obj === "object" && !!obj && typeof obj.sec === "number" && typeof obj.nsec === "number" && Object.getOwnPropertyNames(obj).length === 2;
    }
    function toString(stamp, allowNegative = false) {
      if (!allowNegative && (stamp.sec < 0 || stamp.nsec < 0)) {
        throw new Error(`Invalid negative time { sec: ${stamp.sec}, nsec: ${stamp.nsec} }`);
      }
      const sec = Math.floor(stamp.sec);
      const nsec = Math.floor(stamp.nsec);
      return `${sec}.${nsec.toFixed().padStart(9, "0")}`;
    }
    function parseNanoseconds(digits) {
      const digitsShort = 9 - digits.length;
      return Math.round(parseInt(digits, 10) * 10 ** digitsShort);
    }
    function fromString(stamp) {
      if (/^\d+\.?$/.test(stamp)) {
        const sec2 = parseInt(stamp, 10);
        return { sec: isNaN(sec2) ? 0 : sec2, nsec: 0 };
      }
      if (!/^\d+\.\d+$/.test(stamp)) {
        return void 0;
      }
      const partials = stamp.split(".");
      if (partials.length === 0) {
        return void 0;
      }
      const [first, second] = partials;
      if (first == void 0 || second == void 0) {
        return void 0;
      }
      const sec = parseInt(first, 10);
      const nsec = parseNanoseconds(second);
      return fixTime({ sec: isNaN(sec) ? 0 : sec, nsec });
    }
    function toRFC3339String(stamp) {
      if (stamp.sec < 0 || stamp.nsec < 0) {
        throw new Error(`Invalid negative time { sec: ${stamp.sec}, nsec: ${stamp.nsec} }`);
      }
      if (stamp.nsec >= 1e9) {
        throw new Error(`Invalid nanosecond value ${stamp.nsec}`);
      }
      const date = new Date(stamp.sec * 1e3);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toFixed().padStart(2, "0");
      const day = date.getUTCDate().toFixed().padStart(2, "0");
      const hour = date.getUTCHours().toFixed().padStart(2, "0");
      const minute = date.getUTCMinutes().toFixed().padStart(2, "0");
      const second = date.getUTCSeconds().toFixed().padStart(2, "0");
      const nanosecond = stamp.nsec.toFixed().padStart(9, "0");
      return `${year}-${month}-${day}T${hour}:${minute}:${second}.${nanosecond}Z`;
    }
    function fromRFC3339String(stamp) {
      const match = /^(\d{4,})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(?:[Zz]|([+-])(\d\d):(\d\d))$/.exec(stamp);
      if (match == null) {
        return void 0;
      }
      const [, year, month, day, hour, minute, second, frac, plusMinus, offHours, offMinutes] = match;
      const offSign = plusMinus === "-" ? -1 : 1;
      const utcMillis = Date.UTC(+year, +month - 1, +day, +hour - offSign * +(offHours ?? 0), +minute - offSign * +(offMinutes ?? 0), +second);
      if (utcMillis % 1e3 !== 0) {
        return void 0;
      }
      return fixTime({
        sec: utcMillis / 1e3,
        nsec: frac != void 0 ? parseNanoseconds(frac) : 0
      });
    }
    function toDate(stamp) {
      const { sec, nsec } = stamp;
      return new Date(sec * 1e3 + nsec / 1e6);
    }
    function fromDate(date) {
      const millis = date.getTime();
      const remainder = millis % 1e3;
      return { sec: Math.floor(millis / 1e3), nsec: remainder * 1e6 };
    }
    function percentOf(start, end, target) {
      const totalDuration = subtract(end, start);
      const targetDuration = subtract(target, start);
      return toSec(targetDuration) / toSec(totalDuration);
    }
    function interpolate(start, end, fraction) {
      const duration = subtract(end, start);
      return add(start, fromSec(fraction * toSec(duration)));
    }
    function fixTime(t, allowNegative = false) {
      const durationNanos = t.nsec;
      const secsFromNanos = Math.floor(durationNanos / 1e9);
      const newSecs = t.sec + secsFromNanos;
      const remainingDurationNanos = durationNanos % 1e9;
      const newNanos = Math.abs(Math.sign(remainingDurationNanos) === -1 ? 1e9 + remainingDurationNanos : remainingDurationNanos);
      const result = { sec: newSecs, nsec: newNanos };
      if (!allowNegative && result.sec < 0 || result.nsec < 0) {
        throw new Error(`Cannot normalize invalid time ${toString(result, true)}`);
      }
      return result;
    }
    function add({ sec: sec1, nsec: nsec1 }, { sec: sec2, nsec: nsec2 }) {
      return fixTime({ sec: sec1 + sec2, nsec: nsec1 + nsec2 });
    }
    function subtract({ sec: sec1, nsec: nsec1 }, { sec: sec2, nsec: nsec2 }) {
      return fixTime({ sec: sec1 - sec2, nsec: nsec1 - nsec2 }, true);
    }
    function toNanoSec({ sec, nsec }) {
      return BigInt(sec) * 1000000000n + BigInt(nsec);
    }
    function toMicroSec({ sec, nsec }) {
      return (sec * 1e9 + nsec) / 1e3;
    }
    function toSec({ sec, nsec }) {
      return sec + nsec * 1e-9;
    }
    function fromSec(value) {
      let sec = Math.trunc(value);
      let nsec = Math.round((value - sec) * 1e9);
      sec += Math.trunc(nsec / 1e9);
      nsec %= 1e9;
      return { sec, nsec };
    }
    function fromNanoSec(nsec) {
      return { sec: Number(nsec / 1000000000n), nsec: Number(nsec % 1000000000n) };
    }
    function toMillis(time, roundUp = true) {
      const secondsMillis = time.sec * 1e3;
      const nsecMillis = time.nsec / 1e6;
      return roundUp ? secondsMillis + Math.ceil(nsecMillis) : secondsMillis + Math.floor(nsecMillis);
    }
    function fromMillis(value) {
      let sec = Math.trunc(value / 1e3);
      let nsec = Math.round((value - sec * 1e3) * 1e6);
      sec += Math.trunc(nsec / 1e9);
      nsec %= 1e9;
      return { sec, nsec };
    }
    function fromMicros(value) {
      let sec = Math.trunc(value / 1e6);
      let nsec = Math.round((value - sec * 1e6) * 1e3);
      sec += Math.trunc(nsec / 1e9);
      nsec %= 1e9;
      return { sec, nsec };
    }
    function clampTime(time, start, end) {
      if (compare(start, time) > 0) {
        return { sec: start.sec, nsec: start.nsec };
      }
      if (compare(end, time) < 0) {
        return { sec: end.sec, nsec: end.nsec };
      }
      return { sec: time.sec, nsec: time.nsec };
    }
    function isTimeInRangeInclusive(time, start, end) {
      if (compare(start, time) > 0 || compare(end, time) < 0) {
        return false;
      }
      return true;
    }
    function compare(left, right) {
      const secDiff = left.sec - right.sec;
      return secDiff !== 0 ? secDiff : left.nsec - right.nsec;
    }
    function isLessThan(left, right) {
      return compare(left, right) < 0;
    }
    function isGreaterThan(left, right) {
      return compare(left, right) > 0;
    }
    function areEqual(left, right) {
      return left.sec === right.sec && left.nsec === right.nsec;
    }
  }
});

// node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/index.js
var require_dist5 = __commonJS({
  "node_modules/.pnpm/@foxglove+rostime@1.1.3/node_modules/@foxglove/rostime/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_Time(), exports2);
    __exportStar(require_timeUtils(), exports2);
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/fields.js
var require_fields = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/fields.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extractTime = exports2.extractFields = void 0;
    var EQUALS_CHARCODE = "=".charCodeAt(0);
    function extractFields(buffer) {
      if (buffer.length < 4) {
        throw new Error("fields are truncated.");
      }
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      let offset = 0;
      const fields = {};
      while (offset < buffer.length) {
        const length = view.getInt32(offset, true);
        offset += 4;
        if (offset + length > buffer.length) {
          throw new Error("Header fields are corrupt.");
        }
        const field = buffer.subarray(offset, offset + length);
        const index = field.indexOf(EQUALS_CHARCODE);
        if (index === -1) {
          throw new Error("Header field is missing equals sign.");
        }
        const fieldName = new TextDecoder().decode(field.subarray(0, index));
        fields[fieldName] = field.subarray(index + 1);
        offset += length;
      }
      return fields;
    }
    exports2.extractFields = extractFields;
    function extractTime(buffer, offset) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const sec = view.getUint32(offset, true);
      const nsec = view.getUint32(offset + 4, true);
      return { sec, nsec };
    }
    exports2.extractTime = extractTime;
  }
});

// node_modules/.pnpm/heap@0.2.7/node_modules/heap/lib/heap.js
var require_heap = __commonJS({
  "node_modules/.pnpm/heap@0.2.7/node_modules/heap/lib/heap.js"(exports2, module2) {
    (function() {
      var Heap2, defaultCmp, floor, heapify, heappop, heappush, heappushpop, heapreplace, insort, min, nlargest, nsmallest, updateItem, _siftdown, _siftup;
      floor = Math.floor, min = Math.min;
      defaultCmp = function(x, y) {
        if (x < y) {
          return -1;
        }
        if (x > y) {
          return 1;
        }
        return 0;
      };
      insort = function(a, x, lo, hi, cmp) {
        var mid;
        if (lo == null) {
          lo = 0;
        }
        if (cmp == null) {
          cmp = defaultCmp;
        }
        if (lo < 0) {
          throw new Error("lo must be non-negative");
        }
        if (hi == null) {
          hi = a.length;
        }
        while (lo < hi) {
          mid = floor((lo + hi) / 2);
          if (cmp(x, a[mid]) < 0) {
            hi = mid;
          } else {
            lo = mid + 1;
          }
        }
        return [].splice.apply(a, [lo, lo - lo].concat(x)), x;
      };
      heappush = function(array, item, cmp) {
        if (cmp == null) {
          cmp = defaultCmp;
        }
        array.push(item);
        return _siftdown(array, 0, array.length - 1, cmp);
      };
      heappop = function(array, cmp) {
        var lastelt, returnitem;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        lastelt = array.pop();
        if (array.length) {
          returnitem = array[0];
          array[0] = lastelt;
          _siftup(array, 0, cmp);
        } else {
          returnitem = lastelt;
        }
        return returnitem;
      };
      heapreplace = function(array, item, cmp) {
        var returnitem;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        returnitem = array[0];
        array[0] = item;
        _siftup(array, 0, cmp);
        return returnitem;
      };
      heappushpop = function(array, item, cmp) {
        var _ref;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        if (array.length && cmp(array[0], item) < 0) {
          _ref = [array[0], item], item = _ref[0], array[0] = _ref[1];
          _siftup(array, 0, cmp);
        }
        return item;
      };
      heapify = function(array, cmp) {
        var i, _i, _j, _len, _ref, _ref1, _results, _results1;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        _ref1 = (function() {
          _results1 = [];
          for (var _j2 = 0, _ref2 = floor(array.length / 2); 0 <= _ref2 ? _j2 < _ref2 : _j2 > _ref2; 0 <= _ref2 ? _j2++ : _j2--) {
            _results1.push(_j2);
          }
          return _results1;
        }).apply(this).reverse();
        _results = [];
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          i = _ref1[_i];
          _results.push(_siftup(array, i, cmp));
        }
        return _results;
      };
      updateItem = function(array, item, cmp) {
        var pos;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        pos = array.indexOf(item);
        if (pos === -1) {
          return;
        }
        _siftdown(array, 0, pos, cmp);
        return _siftup(array, pos, cmp);
      };
      nlargest = function(array, n, cmp) {
        var elem, result, _i, _len, _ref;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        result = array.slice(0, n);
        if (!result.length) {
          return result;
        }
        heapify(result, cmp);
        _ref = array.slice(n);
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          elem = _ref[_i];
          heappushpop(result, elem, cmp);
        }
        return result.sort(cmp).reverse();
      };
      nsmallest = function(array, n, cmp) {
        var elem, i, los, result, _i, _j, _len, _ref, _ref1, _results;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        if (n * 10 <= array.length) {
          result = array.slice(0, n).sort(cmp);
          if (!result.length) {
            return result;
          }
          los = result[result.length - 1];
          _ref = array.slice(n);
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            elem = _ref[_i];
            if (cmp(elem, los) < 0) {
              insort(result, elem, 0, null, cmp);
              result.pop();
              los = result[result.length - 1];
            }
          }
          return result;
        }
        heapify(array, cmp);
        _results = [];
        for (i = _j = 0, _ref1 = min(n, array.length); 0 <= _ref1 ? _j < _ref1 : _j > _ref1; i = 0 <= _ref1 ? ++_j : --_j) {
          _results.push(heappop(array, cmp));
        }
        return _results;
      };
      _siftdown = function(array, startpos, pos, cmp) {
        var newitem, parent, parentpos;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        newitem = array[pos];
        while (pos > startpos) {
          parentpos = pos - 1 >> 1;
          parent = array[parentpos];
          if (cmp(newitem, parent) < 0) {
            array[pos] = parent;
            pos = parentpos;
            continue;
          }
          break;
        }
        return array[pos] = newitem;
      };
      _siftup = function(array, pos, cmp) {
        var childpos, endpos, newitem, rightpos, startpos;
        if (cmp == null) {
          cmp = defaultCmp;
        }
        endpos = array.length;
        startpos = pos;
        newitem = array[pos];
        childpos = 2 * pos + 1;
        while (childpos < endpos) {
          rightpos = childpos + 1;
          if (rightpos < endpos && !(cmp(array[childpos], array[rightpos]) < 0)) {
            childpos = rightpos;
          }
          array[pos] = array[childpos];
          pos = childpos;
          childpos = 2 * pos + 1;
        }
        array[pos] = newitem;
        return _siftdown(array, startpos, pos, cmp);
      };
      Heap2 = (function() {
        Heap3.push = heappush;
        Heap3.pop = heappop;
        Heap3.replace = heapreplace;
        Heap3.pushpop = heappushpop;
        Heap3.heapify = heapify;
        Heap3.updateItem = updateItem;
        Heap3.nlargest = nlargest;
        Heap3.nsmallest = nsmallest;
        function Heap3(cmp) {
          this.cmp = cmp != null ? cmp : defaultCmp;
          this.nodes = [];
        }
        Heap3.prototype.push = function(x) {
          return heappush(this.nodes, x, this.cmp);
        };
        Heap3.prototype.pop = function() {
          return heappop(this.nodes, this.cmp);
        };
        Heap3.prototype.peek = function() {
          return this.nodes[0];
        };
        Heap3.prototype.contains = function(x) {
          return this.nodes.indexOf(x) !== -1;
        };
        Heap3.prototype.replace = function(x) {
          return heapreplace(this.nodes, x, this.cmp);
        };
        Heap3.prototype.pushpop = function(x) {
          return heappushpop(this.nodes, x, this.cmp);
        };
        Heap3.prototype.heapify = function() {
          return heapify(this.nodes, this.cmp);
        };
        Heap3.prototype.updateItem = function(x) {
          return updateItem(this.nodes, x, this.cmp);
        };
        Heap3.prototype.clear = function() {
          return this.nodes = [];
        };
        Heap3.prototype.empty = function() {
          return this.nodes.length === 0;
        };
        Heap3.prototype.size = function() {
          return this.nodes.length;
        };
        Heap3.prototype.clone = function() {
          var heap;
          heap = new Heap3();
          heap.nodes = this.nodes.slice(0);
          return heap;
        };
        Heap3.prototype.toArray = function() {
          return this.nodes.slice(0);
        };
        Heap3.prototype.insert = Heap3.prototype.push;
        Heap3.prototype.top = Heap3.prototype.peek;
        Heap3.prototype.front = Heap3.prototype.peek;
        Heap3.prototype.has = Heap3.prototype.contains;
        Heap3.prototype.copy = Heap3.prototype.clone;
        return Heap3;
      })();
      (function(root, factory) {
        if (typeof define === "function" && define.amd) {
          return define([], factory);
        } else if (typeof exports2 === "object") {
          return module2.exports = factory();
        } else {
          return root.Heap = factory();
        }
      })(this, function() {
        return Heap2;
      });
    }).call(exports2);
  }
});

// node_modules/.pnpm/heap@0.2.7/node_modules/heap/index.js
var require_heap2 = __commonJS({
  "node_modules/.pnpm/heap@0.2.7/node_modules/heap/index.js"(exports2, module2) {
    module2.exports = require_heap();
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/nmerge.js
var require_nmerge = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/nmerge.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    var heap_1 = __importDefault(require_heap2());
    function nmerge(key, ...iterables) {
      const heap = new heap_1.default((a, b) => {
        return key(a.value, b.value);
      });
      for (let i = 0; i < iterables.length; i++) {
        const result = iterables[i].next();
        if (result.done !== true) {
          heap.push({ i, value: result.value });
        }
      }
      return {
        next: () => {
          if (heap.empty()) {
            return { done: true, value: void 0 };
          }
          const { i } = heap.front();
          const next = iterables[i].next();
          if (next.done === true) {
            return { value: heap.pop().value, done: false };
          }
          return { value: heap.replace({ i, value: next.value }).value, done: false };
        }
      };
    }
    exports2.default = nmerge;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/record.js
var require_record = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/record.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ChunkInfo = exports2.IndexData = exports2.MessageData = exports2.Connection = exports2.Chunk = exports2.BagHeader = exports2.Record = void 0;
    var fields_1 = require_fields();
    function readUint32(buff) {
      const view = new DataView(buff.buffer, buff.byteOffset, buff.byteLength);
      return view.getUint32(0, true);
    }
    function readInt32(buff) {
      const view = new DataView(buff.buffer, buff.byteOffset, buff.byteLength);
      return view.getInt32(0, true);
    }
    function readBigUInt64(buff) {
      const view = new DataView(buff.buffer, buff.byteOffset, buff.byteLength);
      const bigint = BigInt(view.getUint32(0, true)) | BigInt(view.getUint32(4, true)) << 32n;
      if (bigint > Number.MAX_SAFE_INTEGER) {
        throw new Error(`Read a bigint larger than 2**53: ${bigint}`);
      }
      return Number(bigint);
    }
    var Record = class {
      parseData(_buffer) {
      }
    };
    exports2.Record = Record;
    var BagHeader = class extends Record {
      constructor(fields) {
        super();
        this.indexPosition = readBigUInt64(fields.index_pos);
        this.connectionCount = readInt32(fields.conn_count);
        this.chunkCount = readInt32(fields.chunk_count);
      }
    };
    exports2.BagHeader = BagHeader;
    BagHeader.opcode = 3;
    var Chunk = class extends Record {
      constructor(fields) {
        super();
        this.compression = new TextDecoder().decode(fields.compression);
        this.size = readUint32(fields.size);
      }
      parseData(buffer) {
        this.data = buffer;
      }
    };
    exports2.Chunk = Chunk;
    Chunk.opcode = 5;
    var getField = (fields, key) => {
      if (fields[key] == void 0) {
        throw new Error(`Connection header is missing ${key}.`);
      }
      return new TextDecoder().decode(fields[key]);
    };
    var Connection = class extends Record {
      constructor(fields) {
        super();
        this.conn = readUint32(fields.conn);
        this.topic = new TextDecoder().decode(fields.topic);
        this.type = void 0;
        this.md5sum = void 0;
        this.messageDefinition = "";
      }
      parseData(buffer) {
        const fields = (0, fields_1.extractFields)(buffer);
        this.type = getField(fields, "type");
        this.md5sum = getField(fields, "md5sum");
        this.messageDefinition = getField(fields, "message_definition");
        if (fields.callerid != void 0) {
          this.callerid = new TextDecoder().decode(fields.callerid);
        }
        if (fields.latching != void 0) {
          this.latching = new TextDecoder().decode(fields.latching) === "1";
        }
      }
    };
    exports2.Connection = Connection;
    Connection.opcode = 7;
    var MessageData = class extends Record {
      constructor(fields) {
        super();
        this.conn = readUint32(fields.conn);
        this.time = (0, fields_1.extractTime)(fields.time, 0);
      }
      parseData(buffer) {
        this.data = buffer;
      }
    };
    exports2.MessageData = MessageData;
    MessageData.opcode = 2;
    var IndexData = class extends Record {
      constructor(fields) {
        super();
        this.ver = readUint32(fields.ver);
        this.conn = readUint32(fields.conn);
        this.count = readUint32(fields.count);
      }
      parseData(buffer) {
        this.indices = [];
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < this.count; i++) {
          this.indices.push({
            time: (0, fields_1.extractTime)(buffer, i * 12),
            offset: view.getUint32(i * 12 + 8, true)
          });
        }
      }
    };
    exports2.IndexData = IndexData;
    IndexData.opcode = 4;
    var ChunkInfo = class extends Record {
      constructor(fields) {
        super();
        this.connections = [];
        this.ver = readUint32(fields.ver);
        this.chunkPosition = readBigUInt64(fields.chunk_pos);
        this.startTime = (0, fields_1.extractTime)(fields.start_time, 0);
        this.endTime = (0, fields_1.extractTime)(fields.end_time, 0);
        this.count = readUint32(fields.count);
      }
      parseData(buffer) {
        this.connections = [];
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < this.count; i++) {
          this.connections.push({
            conn: view.getUint32(i * 8, true),
            count: view.getUint32(i * 8 + 4, true)
          });
        }
      }
    };
    exports2.ChunkInfo = ChunkInfo;
    ChunkInfo.opcode = 6;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/BagReader.js
var require_BagReader = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/BagReader.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    var rostime_1 = require_dist5();
    var fields_1 = require_fields();
    var nmerge_1 = __importDefault(require_nmerge());
    var record_1 = require_record();
    var LITTLE_ENDIAN2 = true;
    var HEADER_READAHEAD = 4096;
    var HEADER_OFFSET = 13;
    var BagReader = class {
      constructor(filelike) {
        this._file = filelike;
      }
      async verifyBagHeader() {
        const buffer = await this._file.read(0, HEADER_OFFSET);
        const magic = new TextDecoder().decode(buffer);
        if (magic !== "#ROSBAG V2.0\n") {
          throw new Error("Cannot identify bag format.");
        }
      }
      // reads the header block from the rosbag file
      // generally you call this first
      // because you need the header information to call readConnectionsAndChunkInfo
      async readHeader() {
        await this.verifyBagHeader();
        const buffer = await this._file.read(HEADER_OFFSET, HEADER_READAHEAD);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const read = buffer.length;
        if (read < 8) {
          throw new Error(`Record at position ${HEADER_OFFSET} is truncated.`);
        }
        const headerLength = view.getInt32(0, LITTLE_ENDIAN2);
        if (read < headerLength + 8) {
          throw new Error(`Record at position ${HEADER_OFFSET} header too large: ${headerLength}.`);
        }
        return this.readRecordFromBuffer(buffer, HEADER_OFFSET, record_1.BagHeader);
      }
      // reads connection and chunk information from the bag
      // you'll generally call this after reading the header so you can get
      // connection metadata and chunkInfos which allow you to seek to individual
      // chunks & read them
      async readConnectionsAndChunkInfo(fileOffset, connectionCount, chunkCount) {
        const buffer = await this._file.read(fileOffset, this._file.size() - fileOffset);
        if (connectionCount === 0) {
          return { connections: [], chunkInfos: [] };
        }
        const connections = this.readRecordsFromBuffer(buffer, connectionCount, fileOffset, record_1.Connection);
        const connectionBlockLength = connections[connectionCount - 1].end - connections[0].offset;
        const chunkInfos = this.readRecordsFromBuffer(buffer.subarray(connectionBlockLength), chunkCount, fileOffset + connectionBlockLength, record_1.ChunkInfo);
        if (chunkCount > 0) {
          for (let i = 0; i < chunkCount - 1; i++) {
            chunkInfos[i].nextChunk = chunkInfos[i + 1];
          }
          chunkInfos[chunkCount - 1].nextChunk = void 0;
        }
        return { connections, chunkInfos };
      }
      // read individual raw messages from the bag at a given chunk
      // filters to a specific set of connection ids, start time, & end time
      // generally the records will be of type MessageData
      async readChunkMessages(chunkInfo, connections, startTime, endTime, decompress4) {
        const start = startTime ?? { sec: 0, nsec: 0 };
        const end = endTime ?? { sec: Number.MAX_VALUE, nsec: Number.MAX_VALUE };
        const conns = connections ?? chunkInfo.connections.map((connection) => {
          return connection.conn;
        });
        const result = await this.readChunk(chunkInfo, decompress4);
        const chunk = result.chunk;
        const indices = {};
        result.indices.forEach((index) => {
          indices[index.conn] = index;
        });
        const presentConnections = conns.filter((conn) => {
          return indices[conn] != void 0;
        });
        const iterables = presentConnections.map((conn) => {
          return indices[conn].indices[Symbol.iterator]();
        });
        const iter = (0, nmerge_1.default)((a, b) => (0, rostime_1.compare)(a.time, b.time), ...iterables);
        const entries = [];
        let item = iter.next();
        while (item.done !== true) {
          const { value } = item;
          item = iter.next();
          if (value == null || (0, rostime_1.isGreaterThan)(start, value.time)) {
            continue;
          }
          if ((0, rostime_1.isGreaterThan)(value.time, end)) {
            break;
          }
          entries.push(value);
        }
        const messages = entries.map((entry) => {
          return this.readRecordFromBuffer(chunk.data.subarray(entry.offset), chunk.dataOffset, record_1.MessageData);
        });
        return messages;
      }
      // reads a single chunk record && its index records given a chunkInfo
      async readChunk(chunkInfo, decompress4) {
        if (chunkInfo === this._lastChunkInfo && this._lastReadResult != null) {
          return this._lastReadResult;
        }
        const { nextChunk } = chunkInfo;
        const readLength = nextChunk != null ? nextChunk.chunkPosition - chunkInfo.chunkPosition : this._file.size() - chunkInfo.chunkPosition;
        const buffer = await this._file.read(chunkInfo.chunkPosition, readLength);
        const chunk = this.readRecordFromBuffer(buffer, chunkInfo.chunkPosition, record_1.Chunk);
        const { compression } = chunk;
        if (compression !== "none") {
          const decompressFn = decompress4[compression];
          if (decompressFn == null) {
            throw new Error(`Unsupported compression type ${chunk.compression}`);
          }
          const result = decompressFn(chunk.data, chunk.size);
          chunk.data = result;
        }
        const indices = this.readRecordsFromBuffer(buffer.subarray(chunk.length), chunkInfo.count, chunkInfo.chunkPosition + chunk.length, record_1.IndexData);
        this._lastChunkInfo = chunkInfo;
        this._lastReadResult = { chunk, indices };
        return this._lastReadResult;
      }
      // reads count records from a buffer starting at fileOffset
      readRecordsFromBuffer(buffer, count, fileOffset, cls) {
        const records = [];
        let bufferOffset = 0;
        for (let i = 0; i < count; i++) {
          const record = this.readRecordFromBuffer(buffer.subarray(bufferOffset), fileOffset + bufferOffset, cls);
          bufferOffset += record.end - record.offset;
          records.push(record);
        }
        return records;
      }
      // read an individual record from a buffer
      readRecordFromBuffer(buffer, fileOffset, cls) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const headerLength = view.getInt32(0, LITTLE_ENDIAN2);
        const fields = (0, fields_1.extractFields)(buffer.subarray(4, 4 + headerLength));
        if (fields.op == void 0) {
          throw new Error("Record is missing 'op' field.");
        }
        const opView = new DataView(fields.op.buffer, fields.op.byteOffset, fields.op.byteLength);
        const opcode = opView.getUint8(0);
        if (opcode !== cls.opcode) {
          throw new Error(`Expected ${cls.name} (${cls.opcode}) but found ${opcode}`);
        }
        const record = new cls(fields);
        const dataOffset = 4 + headerLength + 4;
        const dataLength = view.getInt32(4 + headerLength, LITTLE_ENDIAN2);
        const data = new Uint8Array(buffer.buffer.slice(buffer.byteOffset + dataOffset, buffer.byteOffset + dataOffset + dataLength));
        record.parseData(data);
        record.offset = fileOffset;
        record.dataOffset = record.offset + 4 + headerLength + 4;
        record.end = record.dataOffset + dataLength;
        record.length = record.end - record.offset;
        return record;
      }
    };
    exports2.default = BagReader;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/BaseIterator.js
var require_BaseIterator = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/BaseIterator.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.BaseIterator = void 0;
    var heap_1 = __importDefault(require_heap2());
    var record_1 = require_record();
    var BaseIterator = class {
      constructor(args, compare) {
        this.cachedChunkReadResults = /* @__PURE__ */ new Map();
        this.connections = args.connections;
        this.reader = args.reader;
        this.position = args.position;
        this.decompress = args.decompress;
        this.reader = args.reader;
        this.chunkInfos = args.chunkInfos;
        this.heap = new heap_1.default(compare);
        this.parse = args.parse;
        if (args.topics) {
          const topics = args.topics;
          const connectionIds = this.connectionIds = /* @__PURE__ */ new Set();
          for (const [id, connection] of args.connections) {
            if (topics.includes(connection.topic)) {
              this.connectionIds.add(id);
            }
          }
          this.chunkInfos = args.chunkInfos.filter((info) => {
            return info.connections.find((conn) => {
              return connectionIds.has(conn.conn);
            });
          });
        }
      }
      /**
       * @returns An AsyncIterator of MessageEvents
       */
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (!this.heap.front()) {
            const chunkLoaded = await this.loadNext();
            if (!chunkLoaded) {
              return;
            }
          }
          const item = this.heap.pop();
          if (!item) {
            return;
          }
          const chunk = item.chunkReadResult.chunk;
          const messageData = this.reader.readRecordFromBuffer(chunk.data.subarray(item.offset), chunk.dataOffset, record_1.MessageData);
          const connection = this.connections.get(messageData.conn);
          if (!connection) {
            throw new Error(`Unable to find connection with id ${messageData.conn}`);
          }
          const { topic } = connection;
          const { data, time } = messageData;
          if (!data) {
            throw new Error(`No data in message for topic: ${topic}`);
          }
          const event = {
            topic,
            connectionId: messageData.conn,
            timestamp: time,
            data,
            message: this.parse?.(data, connection)
          };
          yield event;
        }
      }
    };
    exports2.BaseIterator = BaseIterator;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ForwardIterator.js
var require_ForwardIterator = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ForwardIterator.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ForwardIterator = void 0;
    var rostime_1 = require_dist5();
    var heap_1 = __importDefault(require_heap2());
    var BaseIterator_1 = require_BaseIterator();
    var ForwardIterator = class extends BaseIterator_1.BaseIterator {
      constructor(args) {
        super(args, (a, b) => {
          return (0, rostime_1.compare)(a.time, b.time);
        });
        this.chunkInfos = this.chunkInfos.filter((info) => {
          return (0, rostime_1.compare)(info.endTime, this.position) >= 0;
        });
        const chunkInfoHeap = new heap_1.default((a, b) => {
          return (0, rostime_1.compare)(a.startTime, b.startTime);
        });
        for (const info of this.chunkInfos) {
          chunkInfoHeap.insert(info);
        }
        this.remainingChunkInfos = [];
        while (chunkInfoHeap.size() > 0) {
          this.remainingChunkInfos.push(chunkInfoHeap.pop());
        }
      }
      async loadNext() {
        const stamp = this.position;
        const firstChunkInfo = this.remainingChunkInfos[0];
        if (!firstChunkInfo) {
          return false;
        }
        this.remainingChunkInfos[0] = void 0;
        let end = firstChunkInfo.endTime;
        const chunksToLoad = [firstChunkInfo];
        for (let idx = 1; idx < this.remainingChunkInfos.length; ++idx) {
          const nextChunkInfo = this.remainingChunkInfos[idx];
          if (!nextChunkInfo) {
            continue;
          }
          if ((0, rostime_1.compare)(nextChunkInfo.startTime, end) > 0) {
            break;
          }
          chunksToLoad.push(nextChunkInfo);
          const endCompare = (0, rostime_1.compare)(nextChunkInfo.endTime, end);
          if (endCompare <= 0) {
            this.remainingChunkInfos[idx] = void 0;
          }
        }
        this.remainingChunkInfos = this.remainingChunkInfos.filter(Boolean);
        if (chunksToLoad.length === 0) {
          return false;
        }
        this.position = end = (0, rostime_1.add)(end, { sec: 0, nsec: 1 });
        const heap = this.heap;
        const newCache = /* @__PURE__ */ new Map();
        for (const chunkInfo of chunksToLoad) {
          let result = this.cachedChunkReadResults.get(chunkInfo.chunkPosition);
          if (!result) {
            result = await this.reader.readChunk(chunkInfo, this.decompress);
          }
          if ((0, rostime_1.compare)(chunkInfo.startTime, end) <= 0 && (0, rostime_1.compare)(chunkInfo.endTime, end) >= 0) {
            newCache.set(chunkInfo.chunkPosition, result);
          }
          for (const indexData of result.indices) {
            if (this.connectionIds && !this.connectionIds.has(indexData.conn)) {
              continue;
            }
            for (const indexEntry of indexData.indices ?? []) {
              if ((0, rostime_1.compare)(indexEntry.time, stamp) < 0 || (0, rostime_1.compare)(indexEntry.time, end) >= 0) {
                continue;
              }
              heap.push({ time: indexEntry.time, offset: indexEntry.offset, chunkReadResult: result });
            }
          }
        }
        this.cachedChunkReadResults = newCache;
        return true;
      }
    };
    exports2.ForwardIterator = ForwardIterator;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ReadResult.js
var require_ReadResult = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ReadResult.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var ReadResult = class {
      constructor(topic, message, timestamp, data, chunkOffset, totalChunks, freeze) {
        this.topic = topic;
        this.message = message;
        this.timestamp = timestamp;
        this.data = data;
        this.chunkOffset = chunkOffset;
        this.totalChunks = totalChunks;
        if (freeze === true) {
          Object.freeze(timestamp);
          Object.freeze(this);
        }
      }
    };
    exports2.default = ReadResult;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ReverseIterator.js
var require_ReverseIterator = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/ReverseIterator.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ReverseIterator = void 0;
    var rostime_1 = require_dist5();
    var heap_1 = __importDefault(require_heap2());
    var BaseIterator_1 = require_BaseIterator();
    var ReverseIterator = class extends BaseIterator_1.BaseIterator {
      constructor(args) {
        super(args, (a, b) => {
          return (0, rostime_1.compare)(b.time, a.time);
        });
        this.chunkInfos = this.chunkInfos.filter((info) => {
          return (0, rostime_1.compare)(info.startTime, this.position) <= 0;
        });
        const chunkInfoHeap = new heap_1.default((a, b) => {
          return (0, rostime_1.compare)(b.endTime, a.endTime);
        });
        for (const info of this.chunkInfos) {
          chunkInfoHeap.insert(info);
        }
        this.remainingChunkInfos = [];
        while (chunkInfoHeap.size() > 0) {
          this.remainingChunkInfos.push(chunkInfoHeap.pop());
        }
      }
      async loadNext() {
        const stamp = this.position;
        const firstChunkInfo = this.remainingChunkInfos[0];
        if (!firstChunkInfo) {
          return false;
        }
        this.remainingChunkInfos[0] = void 0;
        let start = firstChunkInfo.startTime;
        const chunksToLoad = [firstChunkInfo];
        for (let idx = 1; idx < this.remainingChunkInfos.length; ++idx) {
          const nextChunkInfo = this.remainingChunkInfos[idx];
          if (!nextChunkInfo) {
            continue;
          }
          if ((0, rostime_1.compare)(nextChunkInfo.endTime, start) < 0) {
            break;
          }
          chunksToLoad.push(nextChunkInfo);
          const startCompare = (0, rostime_1.compare)(nextChunkInfo.startTime, start);
          if (startCompare >= 0) {
            this.remainingChunkInfos[idx] = void 0;
          }
        }
        this.remainingChunkInfos = this.remainingChunkInfos.filter(Boolean);
        if (chunksToLoad.length === 0) {
          return false;
        }
        this.position = start = (0, rostime_1.subtract)(start, { sec: 0, nsec: 1 });
        const heap = this.heap;
        const newCache = /* @__PURE__ */ new Map();
        for (const chunkInfo of chunksToLoad) {
          let result = this.cachedChunkReadResults.get(chunkInfo.chunkPosition);
          if (!result) {
            result = await this.reader.readChunk(chunkInfo, this.decompress);
          }
          if ((0, rostime_1.compare)(chunkInfo.startTime, start) <= 0 && (0, rostime_1.compare)(chunkInfo.endTime, start) >= 0) {
            newCache.set(chunkInfo.chunkPosition, result);
          }
          for (const indexData of result.indices) {
            if (this.connectionIds && !this.connectionIds.has(indexData.conn)) {
              continue;
            }
            for (const indexEntry of indexData.indices ?? []) {
              if ((0, rostime_1.compare)(indexEntry.time, start) <= 0 || (0, rostime_1.compare)(indexEntry.time, stamp) > 0) {
                continue;
              }
              heap.push({ time: indexEntry.time, offset: indexEntry.offset, chunkReadResult: result });
            }
          }
        }
        this.cachedChunkReadResults = newCache;
        return true;
      }
    };
    exports2.ReverseIterator = ReverseIterator;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/Bag.js
var require_Bag = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/Bag.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    var rosmsg_1 = require_dist4();
    var rosmsg_serialization_1 = require_cjs();
    var rostime_1 = require_dist5();
    var BagReader_1 = __importDefault(require_BagReader());
    var ForwardIterator_1 = require_ForwardIterator();
    var ReadResult_1 = __importDefault(require_ReadResult());
    var ReverseIterator_1 = require_ReverseIterator();
    var Bag2 = class {
      constructor(filelike, opt) {
        this.chunkInfos = [];
        this.reader = new BagReader_1.default(filelike);
        this.connections = /* @__PURE__ */ new Map();
        this.bagOpt = opt ?? {};
      }
      // if the bag is manually created with the constructor, you must call `await open()` on the bag
      // generally this is called for you if you're using `const bag = await Bag.open()`
      async open() {
        this.header = await this.reader.readHeader();
        const { connectionCount, chunkCount, indexPosition } = this.header;
        const result = await this.reader.readConnectionsAndChunkInfo(indexPosition, connectionCount, chunkCount);
        this.connections = /* @__PURE__ */ new Map();
        result.connections.forEach((connection) => {
          this.connections.set(connection.conn, connection);
        });
        this.chunkInfos = result.chunkInfos;
        if (chunkCount > 0) {
          this.startTime = this.chunkInfos[0].startTime;
          this.endTime = this.chunkInfos[chunkCount - 1].endTime;
        }
      }
      messageIterator(opt) {
        const topics = opt?.topics;
        let parse;
        if (this.bagOpt.parse !== false) {
          parse = (data, connection) => {
            connection.reader ?? (connection.reader = new rosmsg_serialization_1.MessageReader((0, rosmsg_1.parse)(connection.messageDefinition)));
            return connection.reader.readMessage(data);
          };
        }
        if (opt?.reverse === true) {
          const position = opt?.start ?? this.endTime;
          if (!position) {
            throw new Error("no timestamp");
          }
          return new ReverseIterator_1.ReverseIterator({
            position,
            topics,
            reader: this.reader,
            connections: this.connections,
            chunkInfos: this.chunkInfos,
            decompress: this.bagOpt.decompress ?? {},
            parse
          });
        } else {
          const position = opt?.start ?? this.startTime;
          if (!position) {
            throw new Error("no timestamp");
          }
          return new ForwardIterator_1.ForwardIterator({
            position,
            topics,
            reader: this.reader,
            chunkInfos: this.chunkInfos,
            connections: this.connections,
            decompress: this.bagOpt.decompress ?? {},
            parse
          });
        }
      }
      /**
       * @deprecated Prefer the messageIterator method instead.
       * @param opts
       * @param callback
       */
      async readMessages(opts, callback) {
        const connections = this.connections;
        const startTime = opts.startTime ?? { sec: 0, nsec: 0 };
        const endTime = opts.endTime ?? { sec: Number.MAX_VALUE, nsec: Number.MAX_VALUE };
        const topics = opts.topics ?? [...connections.values()].map((connection) => connection.topic);
        const filteredConnections = [...connections.values()].filter((connection) => {
          return topics.includes(connection.topic);
        }).map((connection) => connection.conn);
        const { decompress: decompress4 = {} } = opts;
        const chunkInfos = this.chunkInfos.filter((info) => {
          return (0, rostime_1.compare)(info.startTime, endTime) <= 0 && (0, rostime_1.compare)(startTime, info.endTime) <= 0;
        });
        function parseMsg(msg, chunkOffset) {
          const connection = connections.get(msg.conn);
          if (connection == null) {
            throw new Error(`Unable to find connection with id ${msg.conn}`);
          }
          const { topic } = connection;
          const { data, time: timestamp } = msg;
          if (data == null) {
            throw new Error(`No data in message for topic: ${topic}`);
          }
          let message = null;
          if (opts.noParse !== true) {
            connection.reader = connection.reader ?? new rosmsg_serialization_1.MessageReader((0, rosmsg_1.parse)(connection.messageDefinition), {
              freeze: opts.freeze
            });
            message = connection.reader.readMessage(data);
          }
          return new ReadResult_1.default(topic, message, timestamp, data, chunkOffset, chunkInfos.length, opts.freeze);
        }
        for (let i = 0; i < chunkInfos.length; i++) {
          const info = chunkInfos[i];
          const messages = await this.reader.readChunkMessages(info, filteredConnections, startTime, endTime, decompress4);
          messages.forEach((msg) => callback(parseMsg(msg, i)));
        }
      }
    };
    exports2.default = Bag2;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/index.js
var require_cjs2 = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/index.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Bag = void 0;
    var Bag_1 = __importDefault(require_Bag());
    exports2.Bag = Bag_1.default;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/web/BlobReader.js
var require_BlobReader = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/dist/cjs/web/BlobReader.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var BlobReader2 = class {
      constructor(blob) {
        if (!(blob instanceof Blob)) {
          throw new Error("Expected file to be a File or Blob.");
        }
        this._blob = blob;
        this._size = blob.size;
      }
      // read length (bytes) starting from offset (bytes)
      async read(offset, length) {
        const arrBuf = await this._blob.slice(offset, offset + length).arrayBuffer();
        return new Uint8Array(arrBuf);
      }
      // return the size of the file
      size() {
        return this._size;
      }
    };
    exports2.default = BlobReader2;
  }
});

// node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/web.js
var require_web = __commonJS({
  "node_modules/.pnpm/@foxglove+rosbag@0.4.1/node_modules/@foxglove/rosbag/web.js"(exports2, module2) {
    var { default: BlobReader2 } = require_BlobReader();
    module2.exports = {
      BlobReader: BlobReader2
    };
  }
});

// node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/bitreader.js
var require_bitreader = __commonJS({
  "node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/bitreader.js"(exports2, module2) {
    var BITMASK = [0, 1, 3, 7, 15, 31, 63, 127, 255];
    var BitReader = function(stream) {
      this.stream = stream;
      this.bitOffset = 0;
      this.curByte = 0;
      this.hasByte = false;
    };
    BitReader.prototype._ensureByte = function() {
      if (!this.hasByte) {
        this.curByte = this.stream.readByte();
        this.hasByte = true;
      }
    };
    BitReader.prototype.read = function(bits) {
      var result = 0;
      while (bits > 0) {
        this._ensureByte();
        var remaining = 8 - this.bitOffset;
        if (bits >= remaining) {
          result <<= remaining;
          result |= BITMASK[remaining] & this.curByte;
          this.hasByte = false;
          this.bitOffset = 0;
          bits -= remaining;
        } else {
          result <<= bits;
          var shift = remaining - bits;
          result |= (this.curByte & BITMASK[bits] << shift) >> shift;
          this.bitOffset += bits;
          bits = 0;
        }
      }
      return result;
    };
    BitReader.prototype.seek = function(pos) {
      var n_bit = pos % 8;
      var n_byte = (pos - n_bit) / 8;
      this.bitOffset = n_bit;
      this.stream.seek(n_byte);
      this.hasByte = false;
    };
    BitReader.prototype.pi = function() {
      var buf = new Buffer(6), i;
      for (i = 0; i < buf.length; i++) {
        buf[i] = this.read(8);
      }
      return buf.toString("hex");
    };
    module2.exports = BitReader;
  }
});

// node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/stream.js
var require_stream = __commonJS({
  "node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/stream.js"(exports2, module2) {
    var Stream = function() {
    };
    Stream.prototype.readByte = function() {
      throw new Error("abstract method readByte() not implemented");
    };
    Stream.prototype.read = function(buffer, bufOffset, length) {
      var bytesRead = 0;
      while (bytesRead < length) {
        var c = this.readByte();
        if (c < 0) {
          return bytesRead === 0 ? -1 : bytesRead;
        }
        buffer[bufOffset++] = c;
        bytesRead++;
      }
      return bytesRead;
    };
    Stream.prototype.seek = function(new_pos) {
      throw new Error("abstract method seek() not implemented");
    };
    Stream.prototype.writeByte = function(_byte) {
      throw new Error("abstract method readByte() not implemented");
    };
    Stream.prototype.write = function(buffer, bufOffset, length) {
      var i;
      for (i = 0; i < length; i++) {
        this.writeByte(buffer[bufOffset++]);
      }
      return length;
    };
    Stream.prototype.flush = function() {
    };
    module2.exports = Stream;
  }
});

// node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/crc32.js
var require_crc32 = __commonJS({
  "node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/crc32.js"(exports2, module2) {
    module2.exports = (function() {
      var crc32Lookup = new Uint32Array([
        0,
        79764919,
        159529838,
        222504665,
        319059676,
        398814059,
        445009330,
        507990021,
        638119352,
        583659535,
        797628118,
        726387553,
        890018660,
        835552979,
        1015980042,
        944750013,
        1276238704,
        1221641927,
        1167319070,
        1095957929,
        1595256236,
        1540665371,
        1452775106,
        1381403509,
        1780037320,
        1859660671,
        1671105958,
        1733955601,
        2031960084,
        2111593891,
        1889500026,
        1952343757,
        2552477408,
        2632100695,
        2443283854,
        2506133561,
        2334638140,
        2414271883,
        2191915858,
        2254759653,
        3190512472,
        3135915759,
        3081330742,
        3009969537,
        2905550212,
        2850959411,
        2762807018,
        2691435357,
        3560074640,
        3505614887,
        3719321342,
        3648080713,
        3342211916,
        3287746299,
        3467911202,
        3396681109,
        4063920168,
        4143685023,
        4223187782,
        4286162673,
        3779000052,
        3858754371,
        3904687514,
        3967668269,
        881225847,
        809987520,
        1023691545,
        969234094,
        662832811,
        591600412,
        771767749,
        717299826,
        311336399,
        374308984,
        453813921,
        533576470,
        25881363,
        88864420,
        134795389,
        214552010,
        2023205639,
        2086057648,
        1897238633,
        1976864222,
        1804852699,
        1867694188,
        1645340341,
        1724971778,
        1587496639,
        1516133128,
        1461550545,
        1406951526,
        1302016099,
        1230646740,
        1142491917,
        1087903418,
        2896545431,
        2825181984,
        2770861561,
        2716262478,
        3215044683,
        3143675388,
        3055782693,
        3001194130,
        2326604591,
        2389456536,
        2200899649,
        2280525302,
        2578013683,
        2640855108,
        2418763421,
        2498394922,
        3769900519,
        3832873040,
        3912640137,
        3992402750,
        4088425275,
        4151408268,
        4197601365,
        4277358050,
        3334271071,
        3263032808,
        3476998961,
        3422541446,
        3585640067,
        3514407732,
        3694837229,
        3640369242,
        1762451694,
        1842216281,
        1619975040,
        1682949687,
        2047383090,
        2127137669,
        1938468188,
        2001449195,
        1325665622,
        1271206113,
        1183200824,
        1111960463,
        1543535498,
        1489069629,
        1434599652,
        1363369299,
        622672798,
        568075817,
        748617968,
        677256519,
        907627842,
        853037301,
        1067152940,
        995781531,
        51762726,
        131386257,
        177728840,
        240578815,
        269590778,
        349224269,
        429104020,
        491947555,
        4046411278,
        4126034873,
        4172115296,
        4234965207,
        3794477266,
        3874110821,
        3953728444,
        4016571915,
        3609705398,
        3555108353,
        3735388376,
        3664026991,
        3290680682,
        3236090077,
        3449943556,
        3378572211,
        3174993278,
        3120533705,
        3032266256,
        2961025959,
        2923101090,
        2868635157,
        2813903052,
        2742672763,
        2604032198,
        2683796849,
        2461293480,
        2524268063,
        2284983834,
        2364738477,
        2175806836,
        2238787779,
        1569362073,
        1498123566,
        1409854455,
        1355396672,
        1317987909,
        1246755826,
        1192025387,
        1137557660,
        2072149281,
        2135122070,
        1912620623,
        1992383480,
        1753615357,
        1816598090,
        1627664531,
        1707420964,
        295390185,
        358241886,
        404320391,
        483945776,
        43990325,
        106832002,
        186451547,
        266083308,
        932423249,
        861060070,
        1041341759,
        986742920,
        613929101,
        542559546,
        756411363,
        701822548,
        3316196985,
        3244833742,
        3425377559,
        3370778784,
        3601682597,
        3530312978,
        3744426955,
        3689838204,
        3819031489,
        3881883254,
        3928223919,
        4007849240,
        4037393693,
        4100235434,
        4180117107,
        4259748804,
        2310601993,
        2373574846,
        2151335527,
        2231098320,
        2596047829,
        2659030626,
        2470359227,
        2550115596,
        2947551409,
        2876312838,
        2788305887,
        2733848168,
        3165939309,
        3094707162,
        3040238851,
        2985771188
      ]);
      var CRC32 = function() {
        var crc = 4294967295;
        this.getCRC = function() {
          return ~crc >>> 0;
        };
        this.updateCRC = function(value) {
          crc = crc << 8 ^ crc32Lookup[(crc >>> 24 ^ value) & 255];
        };
        this.updateCRCRun = function(value, count) {
          while (count-- > 0) {
            crc = crc << 8 ^ crc32Lookup[(crc >>> 24 ^ value) & 255];
          }
        };
      };
      return CRC32;
    })();
  }
});

// node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/package.json
var require_package = __commonJS({
  "node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/package.json"(exports2, module2) {
    module2.exports = {
      name: "seek-bzip",
      version: "2.0.0",
      contributors: [
        "C. Scott Ananian (http://cscott.net)",
        "Eli Skeggs",
        "Kevin Kwok",
        "Rob Landley (http://landley.net)"
      ],
      description: "a pure-JavaScript Node.JS module for random-access decoding bzip2 data",
      main: "./lib/index.js",
      repository: {
        type: "git",
        url: "https://github.com/cscott/seek-bzip.git"
      },
      license: "MIT",
      bin: {
        "seek-bunzip": "./bin/seek-bunzip",
        "seek-table": "./bin/seek-bzip-table"
      },
      directories: {
        test: "test"
      },
      dependencies: {
        commander: "^6.0.0"
      },
      devDependencies: {
        fibers: "^5.0.0",
        mocha: "^8.1.0"
      },
      scripts: {
        test: "mocha"
      }
    };
  }
});

// node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/index.js
var require_lib = __commonJS({
  "node_modules/.pnpm/seek-bzip@2.0.0/node_modules/seek-bzip/lib/index.js"(exports2, module2) {
    var BitReader = require_bitreader();
    var Stream = require_stream();
    var CRC32 = require_crc32();
    var pjson = require_package();
    var MAX_HUFCODE_BITS = 20;
    var MAX_SYMBOLS = 258;
    var SYMBOL_RUNA = 0;
    var SYMBOL_RUNB = 1;
    var MIN_GROUPS = 2;
    var MAX_GROUPS = 6;
    var GROUP_SIZE = 50;
    var WHOLEPI = "314159265359";
    var SQRTPI = "177245385090";
    var mtf = function(array, index) {
      var src = array[index], i;
      for (i = index; i > 0; i--) {
        array[i] = array[i - 1];
      }
      array[0] = src;
      return src;
    };
    var Err = {
      OK: 0,
      LAST_BLOCK: -1,
      NOT_BZIP_DATA: -2,
      UNEXPECTED_INPUT_EOF: -3,
      UNEXPECTED_OUTPUT_EOF: -4,
      DATA_ERROR: -5,
      OUT_OF_MEMORY: -6,
      OBSOLETE_INPUT: -7,
      END_OF_BLOCK: -8
    };
    var ErrorMessages = {};
    ErrorMessages[Err.LAST_BLOCK] = "Bad file checksum";
    ErrorMessages[Err.NOT_BZIP_DATA] = "Not bzip data";
    ErrorMessages[Err.UNEXPECTED_INPUT_EOF] = "Unexpected input EOF";
    ErrorMessages[Err.UNEXPECTED_OUTPUT_EOF] = "Unexpected output EOF";
    ErrorMessages[Err.DATA_ERROR] = "Data error";
    ErrorMessages[Err.OUT_OF_MEMORY] = "Out of memory";
    ErrorMessages[Err.OBSOLETE_INPUT] = "Obsolete (pre 0.9.5) bzip format not supported.";
    var _throw = function(status, optDetail) {
      var msg = ErrorMessages[status] || "unknown error";
      if (optDetail) {
        msg += ": " + optDetail;
      }
      var e = new TypeError(msg);
      e.errorCode = status;
      throw e;
    };
    var Bunzip2 = function(inputStream, outputStream) {
      this.writePos = this.writeCurrent = this.writeCount = 0;
      this._start_bunzip(inputStream, outputStream);
    };
    Bunzip2.prototype._init_block = function() {
      var moreBlocks = this._get_next_block();
      if (!moreBlocks) {
        this.writeCount = -1;
        return false;
      }
      this.blockCRC = new CRC32();
      return true;
    };
    Bunzip2.prototype._start_bunzip = function(inputStream, outputStream) {
      var buf = new Buffer(4);
      if (inputStream.read(buf, 0, 4) !== 4 || String.fromCharCode(buf[0], buf[1], buf[2]) !== "BZh")
        _throw(Err.NOT_BZIP_DATA, "bad magic");
      var level = buf[3] - 48;
      if (level < 1 || level > 9)
        _throw(Err.NOT_BZIP_DATA, "level out of range");
      this.reader = new BitReader(inputStream);
      this.dbufSize = 1e5 * level;
      this.nextoutput = 0;
      this.outputStream = outputStream;
      this.streamCRC = 0;
    };
    Bunzip2.prototype._get_next_block = function() {
      var i, j, k;
      var reader = this.reader;
      var h = reader.pi();
      if (h === SQRTPI) {
        return false;
      }
      if (h !== WHOLEPI)
        _throw(Err.NOT_BZIP_DATA);
      this.targetBlockCRC = reader.read(32) >>> 0;
      this.streamCRC = (this.targetBlockCRC ^ (this.streamCRC << 1 | this.streamCRC >>> 31)) >>> 0;
      if (reader.read(1))
        _throw(Err.OBSOLETE_INPUT);
      var origPointer = reader.read(24);
      if (origPointer > this.dbufSize)
        _throw(Err.DATA_ERROR, "initial position out of bounds");
      var t = reader.read(16);
      var symToByte = new Buffer(256), symTotal = 0;
      for (i = 0; i < 16; i++) {
        if (t & 1 << 15 - i) {
          var o = i * 16;
          k = reader.read(16);
          for (j = 0; j < 16; j++)
            if (k & 1 << 15 - j)
              symToByte[symTotal++] = o + j;
        }
      }
      var groupCount = reader.read(3);
      if (groupCount < MIN_GROUPS || groupCount > MAX_GROUPS)
        _throw(Err.DATA_ERROR);
      var nSelectors = reader.read(15);
      if (nSelectors === 0)
        _throw(Err.DATA_ERROR);
      var mtfSymbol = new Buffer(256);
      for (i = 0; i < groupCount; i++)
        mtfSymbol[i] = i;
      var selectors = new Buffer(nSelectors);
      for (i = 0; i < nSelectors; i++) {
        for (j = 0; reader.read(1); j++)
          if (j >= groupCount) _throw(Err.DATA_ERROR);
        selectors[i] = mtf(mtfSymbol, j);
      }
      var symCount = symTotal + 2;
      var groups = [], hufGroup;
      for (j = 0; j < groupCount; j++) {
        var length = new Buffer(symCount), temp = new Uint16Array(MAX_HUFCODE_BITS + 1);
        t = reader.read(5);
        for (i = 0; i < symCount; i++) {
          for (; ; ) {
            if (t < 1 || t > MAX_HUFCODE_BITS) _throw(Err.DATA_ERROR);
            if (!reader.read(1))
              break;
            if (!reader.read(1))
              t++;
            else
              t--;
          }
          length[i] = t;
        }
        var minLen, maxLen;
        minLen = maxLen = length[0];
        for (i = 1; i < symCount; i++) {
          if (length[i] > maxLen)
            maxLen = length[i];
          else if (length[i] < minLen)
            minLen = length[i];
        }
        hufGroup = {};
        groups.push(hufGroup);
        hufGroup.permute = new Uint16Array(MAX_SYMBOLS);
        hufGroup.limit = new Uint32Array(MAX_HUFCODE_BITS + 2);
        hufGroup.base = new Uint32Array(MAX_HUFCODE_BITS + 1);
        hufGroup.minLen = minLen;
        hufGroup.maxLen = maxLen;
        var pp = 0;
        for (i = minLen; i <= maxLen; i++) {
          temp[i] = hufGroup.limit[i] = 0;
          for (t = 0; t < symCount; t++)
            if (length[t] === i)
              hufGroup.permute[pp++] = t;
        }
        for (i = 0; i < symCount; i++)
          temp[length[i]]++;
        pp = t = 0;
        for (i = minLen; i < maxLen; i++) {
          pp += temp[i];
          hufGroup.limit[i] = pp - 1;
          pp <<= 1;
          t += temp[i];
          hufGroup.base[i + 1] = pp - t;
        }
        hufGroup.limit[maxLen + 1] = Number.MAX_VALUE;
        hufGroup.limit[maxLen] = pp + temp[maxLen] - 1;
        hufGroup.base[minLen] = 0;
      }
      var byteCount = new Uint32Array(256);
      for (i = 0; i < 256; i++)
        mtfSymbol[i] = i;
      var runPos = 0, dbufCount = 0, selector = 0, uc;
      var dbuf = this.dbuf = new Uint32Array(this.dbufSize);
      symCount = 0;
      for (; ; ) {
        if (!symCount--) {
          symCount = GROUP_SIZE - 1;
          if (selector >= nSelectors) {
            _throw(Err.DATA_ERROR);
          }
          hufGroup = groups[selectors[selector++]];
        }
        i = hufGroup.minLen;
        j = reader.read(i);
        for (; ; i++) {
          if (i > hufGroup.maxLen) {
            _throw(Err.DATA_ERROR);
          }
          if (j <= hufGroup.limit[i])
            break;
          j = j << 1 | reader.read(1);
        }
        j -= hufGroup.base[i];
        if (j < 0 || j >= MAX_SYMBOLS) {
          _throw(Err.DATA_ERROR);
        }
        var nextSym = hufGroup.permute[j];
        if (nextSym === SYMBOL_RUNA || nextSym === SYMBOL_RUNB) {
          if (!runPos) {
            runPos = 1;
            t = 0;
          }
          if (nextSym === SYMBOL_RUNA)
            t += runPos;
          else
            t += 2 * runPos;
          runPos <<= 1;
          continue;
        }
        if (runPos) {
          runPos = 0;
          if (dbufCount + t > this.dbufSize) {
            _throw(Err.DATA_ERROR);
          }
          uc = symToByte[mtfSymbol[0]];
          byteCount[uc] += t;
          while (t--)
            dbuf[dbufCount++] = uc;
        }
        if (nextSym > symTotal)
          break;
        if (dbufCount >= this.dbufSize) {
          _throw(Err.DATA_ERROR);
        }
        i = nextSym - 1;
        uc = mtf(mtfSymbol, i);
        uc = symToByte[uc];
        byteCount[uc]++;
        dbuf[dbufCount++] = uc;
      }
      if (origPointer < 0 || origPointer >= dbufCount) {
        _throw(Err.DATA_ERROR);
      }
      j = 0;
      for (i = 0; i < 256; i++) {
        k = j + byteCount[i];
        byteCount[i] = j;
        j = k;
      }
      for (i = 0; i < dbufCount; i++) {
        uc = dbuf[i] & 255;
        dbuf[byteCount[uc]] |= i << 8;
        byteCount[uc]++;
      }
      var pos = 0, current = 0, run2 = 0;
      if (dbufCount) {
        pos = dbuf[origPointer];
        current = pos & 255;
        pos >>= 8;
        run2 = -1;
      }
      this.writePos = pos;
      this.writeCurrent = current;
      this.writeCount = dbufCount;
      this.writeRun = run2;
      return true;
    };
    Bunzip2.prototype._read_bunzip = function(outputBuffer, len) {
      var copies, previous, outbyte;
      if (this.writeCount < 0) {
        return 0;
      }
      var gotcount = 0;
      var dbuf = this.dbuf, pos = this.writePos, current = this.writeCurrent;
      var dbufCount = this.writeCount, outputsize = this.outputsize;
      var run2 = this.writeRun;
      while (dbufCount) {
        dbufCount--;
        previous = current;
        pos = dbuf[pos];
        current = pos & 255;
        pos >>= 8;
        if (run2++ === 3) {
          copies = current;
          outbyte = previous;
          current = -1;
        } else {
          copies = 1;
          outbyte = current;
        }
        this.blockCRC.updateCRCRun(outbyte, copies);
        while (copies--) {
          this.outputStream.writeByte(outbyte);
          this.nextoutput++;
        }
        if (current != previous)
          run2 = 0;
      }
      this.writeCount = dbufCount;
      if (this.blockCRC.getCRC() !== this.targetBlockCRC) {
        _throw(Err.DATA_ERROR, "Bad block CRC (got " + this.blockCRC.getCRC().toString(16) + " expected " + this.targetBlockCRC.toString(16) + ")");
      }
      return this.nextoutput;
    };
    var coerceInputStream = function(input) {
      if ("readByte" in input) {
        return input;
      }
      var inputStream = new Stream();
      inputStream.pos = 0;
      inputStream.readByte = function() {
        return input[this.pos++];
      };
      inputStream.seek = function(pos) {
        this.pos = pos;
      };
      inputStream.eof = function() {
        return this.pos >= input.length;
      };
      return inputStream;
    };
    var coerceOutputStream = function(output) {
      var outputStream = new Stream();
      var resizeOk = true;
      if (output) {
        if (typeof output === "number") {
          outputStream.buffer = new Buffer(output);
          resizeOk = false;
        } else if ("writeByte" in output) {
          return output;
        } else {
          outputStream.buffer = output;
          resizeOk = false;
        }
      } else {
        outputStream.buffer = new Buffer(16384);
      }
      outputStream.pos = 0;
      outputStream.writeByte = function(_byte) {
        if (resizeOk && this.pos >= this.buffer.length) {
          var newBuffer = new Buffer(this.buffer.length * 2);
          this.buffer.copy(newBuffer);
          this.buffer = newBuffer;
        }
        this.buffer[this.pos++] = _byte;
      };
      outputStream.getBuffer = function() {
        if (this.pos !== this.buffer.length) {
          if (!resizeOk)
            throw new TypeError("outputsize does not match decoded input");
          var newBuffer = new Buffer(this.pos);
          this.buffer.copy(newBuffer, 0, 0, this.pos);
          this.buffer = newBuffer;
        }
        return this.buffer;
      };
      outputStream._coerced = true;
      return outputStream;
    };
    Bunzip2.Err = Err;
    Bunzip2.decode = function(input, output, multistream) {
      var inputStream = coerceInputStream(input);
      var outputStream = coerceOutputStream(output);
      var bz = new Bunzip2(inputStream, outputStream);
      while (true) {
        if ("eof" in inputStream && inputStream.eof()) break;
        if (bz._init_block()) {
          bz._read_bunzip();
        } else {
          var targetStreamCRC = bz.reader.read(32) >>> 0;
          if (targetStreamCRC !== bz.streamCRC) {
            _throw(Err.DATA_ERROR, "Bad stream CRC (got " + bz.streamCRC.toString(16) + " expected " + targetStreamCRC.toString(16) + ")");
          }
          if (multistream && "eof" in inputStream && !inputStream.eof()) {
            bz._start_bunzip(inputStream, outputStream);
          } else break;
        }
      }
      if ("getBuffer" in outputStream)
        return outputStream.getBuffer();
    };
    Bunzip2.decodeBlock = function(input, pos, output) {
      var inputStream = coerceInputStream(input);
      var outputStream = coerceOutputStream(output);
      var bz = new Bunzip2(inputStream, outputStream);
      bz.reader.seek(pos);
      var moreBlocks = bz._get_next_block();
      if (moreBlocks) {
        bz.blockCRC = new CRC32();
        bz.writeCopies = 0;
        bz._read_bunzip();
      }
      if ("getBuffer" in outputStream)
        return outputStream.getBuffer();
    };
    Bunzip2.table = function(input, callback, multistream) {
      var inputStream = new Stream();
      inputStream.delegate = coerceInputStream(input);
      inputStream.pos = 0;
      inputStream.readByte = function() {
        this.pos++;
        return this.delegate.readByte();
      };
      if (inputStream.delegate.eof) {
        inputStream.eof = inputStream.delegate.eof.bind(inputStream.delegate);
      }
      var outputStream = new Stream();
      outputStream.pos = 0;
      outputStream.writeByte = function() {
        this.pos++;
      };
      var bz = new Bunzip2(inputStream, outputStream);
      var blockSize = bz.dbufSize;
      while (true) {
        if ("eof" in inputStream && inputStream.eof()) break;
        var position = inputStream.pos * 8 + bz.reader.bitOffset;
        if (bz.reader.hasByte) {
          position -= 8;
        }
        if (bz._init_block()) {
          var start = outputStream.pos;
          bz._read_bunzip();
          callback(position, outputStream.pos - start);
        } else {
          var crc = bz.reader.read(32);
          if (multistream && "eof" in inputStream && !inputStream.eof()) {
            bz._start_bunzip(inputStream, outputStream);
            console.assert(
              bz.dbufSize === blockSize,
              "shouldn't change block size within multistream file"
            );
          } else break;
        }
      }
    };
    Bunzip2.Stream = Stream;
    Bunzip2.version = pjson.version;
    Bunzip2.license = pjson.license;
    module2.exports = Bunzip2;
  }
});

// node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/util.js
var require_util = __commonJS({
  "node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/util.js"(exports2) {
    exports2.hashU32 = function hashU32(a) {
      a = a | 0;
      a = a + 2127912214 + (a << 12) | 0;
      a = a ^ -949894596 ^ a >>> 19;
      a = a + 374761393 + (a << 5) | 0;
      a = a + -744332180 ^ a << 9;
      a = a + -42973499 + (a << 3) | 0;
      return a ^ -1252372727 ^ a >>> 16 | 0;
    };
    exports2.readU64 = function readU64(b, n) {
      var x = 0;
      x |= b[n++] << 0;
      x |= b[n++] << 8;
      x |= b[n++] << 16;
      x |= b[n++] << 24;
      x |= b[n++] << 32;
      x |= b[n++] << 40;
      x |= b[n++] << 48;
      x |= b[n++] << 56;
      return x;
    };
    exports2.readU32 = function readU32(b, n) {
      var x = 0;
      x |= b[n++] << 0;
      x |= b[n++] << 8;
      x |= b[n++] << 16;
      x |= b[n++] << 24;
      return x;
    };
    exports2.writeU32 = function writeU32(b, n, x) {
      b[n++] = x >> 0 & 255;
      b[n++] = x >> 8 & 255;
      b[n++] = x >> 16 & 255;
      b[n++] = x >> 24 & 255;
    };
    exports2.imul = function imul(a, b) {
      var ah = a >>> 16;
      var al = a & 65535;
      var bh = b >>> 16;
      var bl = b & 65535;
      return al * bl + (ah * bl + al * bh << 16) | 0;
    };
  }
});

// node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/xxh32.js
var require_xxh32 = __commonJS({
  "node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/xxh32.js"(exports2) {
    var util = require_util();
    var prime1 = 2654435761;
    var prime2 = 2246822519;
    var prime3 = 3266489917;
    var prime4 = 668265263;
    var prime5 = 374761393;
    function rotl32(x, r) {
      x = x | 0;
      r = r | 0;
      return x >>> (32 - r | 0) | x << r | 0;
    }
    function rotmul32(h, r, m) {
      h = h | 0;
      r = r | 0;
      m = m | 0;
      return util.imul(h >>> (32 - r | 0) | h << r, m) | 0;
    }
    function shiftxor32(h, s) {
      h = h | 0;
      s = s | 0;
      return h >>> s ^ h | 0;
    }
    function xxhapply(h, src, m0, s, m1) {
      return rotmul32(util.imul(src, m0) + h, s, m1);
    }
    function xxh1(h, src, index) {
      return rotmul32(h + util.imul(src[index], prime5), 11, prime1);
    }
    function xxh4(h, src, index) {
      return xxhapply(h, util.readU32(src, index), prime3, 17, prime4);
    }
    function xxh16(h, src, index) {
      return [
        xxhapply(h[0], util.readU32(src, index + 0), prime2, 13, prime1),
        xxhapply(h[1], util.readU32(src, index + 4), prime2, 13, prime1),
        xxhapply(h[2], util.readU32(src, index + 8), prime2, 13, prime1),
        xxhapply(h[3], util.readU32(src, index + 12), prime2, 13, prime1)
      ];
    }
    function xxh32(seed, src, index, len) {
      var h, l;
      l = len;
      if (len >= 16) {
        h = [
          seed + prime1 + prime2,
          seed + prime2,
          seed,
          seed - prime1
        ];
        while (len >= 16) {
          h = xxh16(h, src, index);
          index += 16;
          len -= 16;
        }
        h = rotl32(h[0], 1) + rotl32(h[1], 7) + rotl32(h[2], 12) + rotl32(h[3], 18) + l;
      } else {
        h = seed + prime5 + len >>> 0;
      }
      while (len >= 4) {
        h = xxh4(h, src, index);
        index += 4;
        len -= 4;
      }
      while (len > 0) {
        h = xxh1(h, src, index);
        index++;
        len--;
      }
      h = shiftxor32(util.imul(shiftxor32(util.imul(shiftxor32(h, 15), prime2), 13), prime3), 16);
      return h >>> 0;
    }
    exports2.hash = xxh32;
  }
});

// node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/lz4.js
var require_lz4 = __commonJS({
  "node_modules/.pnpm/lz4js@0.2.0/node_modules/lz4js/lz4.js"(exports2) {
    var xxhash = require_xxh32();
    var util = require_util();
    var minMatch = 4;
    var minLength = 13;
    var searchLimit = 5;
    var skipTrigger = 6;
    var hashSize = 1 << 16;
    var mlBits = 4;
    var mlMask = (1 << mlBits) - 1;
    var runBits = 4;
    var runMask = (1 << runBits) - 1;
    var blockBuf = makeBuffer(5 << 20);
    var hashTable = makeHashTable();
    var magicNum = 407708164;
    var fdContentChksum = 4;
    var fdContentSize = 8;
    var fdBlockChksum = 16;
    var fdVersion = 64;
    var fdVersionMask = 192;
    var bsUncompressed = 2147483648;
    var bsDefault = 7;
    var bsShift = 4;
    var bsMask = 7;
    var bsMap = {
      4: 65536,
      5: 262144,
      6: 1048576,
      7: 4194304
    };
    function makeHashTable() {
      try {
        return new Uint32Array(hashSize);
      } catch (error) {
        var hashTable2 = new Array(hashSize);
        for (var i = 0; i < hashSize; i++) {
          hashTable2[i] = 0;
        }
        return hashTable2;
      }
    }
    function clearHashTable(table) {
      for (var i = 0; i < hashSize; i++) {
        hashTable[i] = 0;
      }
    }
    function makeBuffer(size) {
      try {
        return new Uint8Array(size);
      } catch (error) {
        var buf = new Array(size);
        for (var i = 0; i < size; i++) {
          buf[i] = 0;
        }
        return buf;
      }
    }
    function sliceArray(array, start, end) {
      if (typeof array.buffer !== void 0) {
        if (Uint8Array.prototype.slice) {
          return array.slice(start, end);
        } else {
          var len = array.length;
          start = start | 0;
          start = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
          end = end === void 0 ? len : end | 0;
          end = end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
          var arraySlice = new Uint8Array(end - start);
          for (var i = start, n = 0; i < end; ) {
            arraySlice[n++] = array[i++];
          }
          return arraySlice;
        }
      } else {
        return array.slice(start, end);
      }
    }
    exports2.compressBound = function compressBound(n) {
      return n + n / 255 + 16 | 0;
    };
    exports2.decompressBound = function decompressBound(src) {
      var sIndex = 0;
      if (util.readU32(src, sIndex) !== magicNum) {
        throw new Error("invalid magic number");
      }
      sIndex += 4;
      var descriptor = src[sIndex++];
      if ((descriptor & fdVersionMask) !== fdVersion) {
        throw new Error("incompatible descriptor version " + (descriptor & fdVersionMask));
      }
      var useBlockSum = (descriptor & fdBlockChksum) !== 0;
      var useContentSize = (descriptor & fdContentSize) !== 0;
      var bsIdx = src[sIndex++] >> bsShift & bsMask;
      if (bsMap[bsIdx] === void 0) {
        throw new Error("invalid block size " + bsIdx);
      }
      var maxBlockSize = bsMap[bsIdx];
      if (useContentSize) {
        return util.readU64(src, sIndex);
      }
      sIndex++;
      var maxSize = 0;
      while (true) {
        var blockSize = util.readU32(src, sIndex);
        sIndex += 4;
        if (blockSize & bsUncompressed) {
          blockSize &= ~bsUncompressed;
          maxSize += blockSize;
        } else {
          maxSize += maxBlockSize;
        }
        if (blockSize === 0) {
          return maxSize;
        }
        if (useBlockSum) {
          sIndex += 4;
        }
        sIndex += blockSize;
      }
    };
    exports2.makeBuffer = makeBuffer;
    exports2.decompressBlock = function decompressBlock(src, dst, sIndex, sLength, dIndex) {
      var mLength, mOffset, sEnd, n, i;
      sEnd = sIndex + sLength;
      while (sIndex < sEnd) {
        var token = src[sIndex++];
        var literalCount = token >> 4;
        if (literalCount > 0) {
          if (literalCount === 15) {
            while (true) {
              literalCount += src[sIndex];
              if (src[sIndex++] !== 255) {
                break;
              }
            }
          }
          for (n = sIndex + literalCount; sIndex < n; ) {
            dst[dIndex++] = src[sIndex++];
          }
        }
        if (sIndex >= sEnd) {
          break;
        }
        mLength = token & 15;
        mOffset = src[sIndex++] | src[sIndex++] << 8;
        if (mLength === 15) {
          while (true) {
            mLength += src[sIndex];
            if (src[sIndex++] !== 255) {
              break;
            }
          }
        }
        mLength += minMatch;
        for (i = dIndex - mOffset, n = i + mLength; i < n; ) {
          dst[dIndex++] = dst[i++] | 0;
        }
      }
      return dIndex;
    };
    exports2.compressBlock = function compressBlock(src, dst, sIndex, sLength, hashTable2) {
      var mIndex, mAnchor, mLength, mOffset, mStep;
      var literalCount, dIndex, sEnd, n;
      dIndex = 0;
      sEnd = sLength + sIndex;
      mAnchor = sIndex;
      if (sLength >= minLength) {
        var searchMatchCount = (1 << skipTrigger) + 3;
        while (sIndex + minMatch < sEnd - searchLimit) {
          var seq = util.readU32(src, sIndex);
          var hash = util.hashU32(seq) >>> 0;
          hash = (hash >> 16 ^ hash) >>> 0 & 65535;
          mIndex = hashTable2[hash] - 1;
          hashTable2[hash] = sIndex + 1;
          if (mIndex < 0 || sIndex - mIndex >>> 16 > 0 || util.readU32(src, mIndex) !== seq) {
            mStep = searchMatchCount++ >> skipTrigger;
            sIndex += mStep;
            continue;
          }
          searchMatchCount = (1 << skipTrigger) + 3;
          literalCount = sIndex - mAnchor;
          mOffset = sIndex - mIndex;
          sIndex += minMatch;
          mIndex += minMatch;
          mLength = sIndex;
          while (sIndex < sEnd - searchLimit && src[sIndex] === src[mIndex]) {
            sIndex++;
            mIndex++;
          }
          mLength = sIndex - mLength;
          var token = mLength < mlMask ? mLength : mlMask;
          if (literalCount >= runMask) {
            dst[dIndex++] = (runMask << mlBits) + token;
            for (n = literalCount - runMask; n >= 255; n -= 255) {
              dst[dIndex++] = 255;
            }
            dst[dIndex++] = n;
          } else {
            dst[dIndex++] = (literalCount << mlBits) + token;
          }
          for (var i = 0; i < literalCount; i++) {
            dst[dIndex++] = src[mAnchor + i];
          }
          dst[dIndex++] = mOffset;
          dst[dIndex++] = mOffset >> 8;
          if (mLength >= mlMask) {
            for (n = mLength - mlMask; n >= 255; n -= 255) {
              dst[dIndex++] = 255;
            }
            dst[dIndex++] = n;
          }
          mAnchor = sIndex;
        }
      }
      if (mAnchor === 0) {
        return 0;
      }
      literalCount = sEnd - mAnchor;
      if (literalCount >= runMask) {
        dst[dIndex++] = runMask << mlBits;
        for (n = literalCount - runMask; n >= 255; n -= 255) {
          dst[dIndex++] = 255;
        }
        dst[dIndex++] = n;
      } else {
        dst[dIndex++] = literalCount << mlBits;
      }
      sIndex = mAnchor;
      while (sIndex < sEnd) {
        dst[dIndex++] = src[sIndex++];
      }
      return dIndex;
    };
    exports2.decompressFrame = function decompressFrame(src, dst) {
      var useBlockSum, useContentSum, useContentSize, descriptor;
      var sIndex = 0;
      var dIndex = 0;
      if (util.readU32(src, sIndex) !== magicNum) {
        throw new Error("invalid magic number");
      }
      sIndex += 4;
      descriptor = src[sIndex++];
      if ((descriptor & fdVersionMask) !== fdVersion) {
        throw new Error("incompatible descriptor version");
      }
      useBlockSum = (descriptor & fdBlockChksum) !== 0;
      useContentSum = (descriptor & fdContentChksum) !== 0;
      useContentSize = (descriptor & fdContentSize) !== 0;
      var bsIdx = src[sIndex++] >> bsShift & bsMask;
      if (bsMap[bsIdx] === void 0) {
        throw new Error("invalid block size");
      }
      if (useContentSize) {
        sIndex += 8;
      }
      sIndex++;
      while (true) {
        var compSize;
        compSize = util.readU32(src, sIndex);
        sIndex += 4;
        if (compSize === 0) {
          break;
        }
        if (useBlockSum) {
          sIndex += 4;
        }
        if ((compSize & bsUncompressed) !== 0) {
          compSize &= ~bsUncompressed;
          for (var j = 0; j < compSize; j++) {
            dst[dIndex++] = src[sIndex++];
          }
        } else {
          dIndex = exports2.decompressBlock(src, dst, sIndex, compSize, dIndex);
          sIndex += compSize;
        }
      }
      if (useContentSum) {
        sIndex += 4;
      }
      return dIndex;
    };
    exports2.compressFrame = function compressFrame(src, dst) {
      var dIndex = 0;
      util.writeU32(dst, dIndex, magicNum);
      dIndex += 4;
      dst[dIndex++] = fdVersion;
      dst[dIndex++] = bsDefault << bsShift;
      dst[dIndex] = xxhash.hash(0, dst, 4, dIndex - 4) >> 8;
      dIndex++;
      var maxBlockSize = bsMap[bsDefault];
      var remaining = src.length;
      var sIndex = 0;
      clearHashTable(hashTable);
      while (remaining > 0) {
        var compSize = 0;
        var blockSize = remaining > maxBlockSize ? maxBlockSize : remaining;
        compSize = exports2.compressBlock(src, blockBuf, sIndex, blockSize, hashTable);
        if (compSize > blockSize || compSize === 0) {
          util.writeU32(dst, dIndex, 2147483648 | blockSize);
          dIndex += 4;
          for (var z = sIndex + blockSize; sIndex < z; ) {
            dst[dIndex++] = src[sIndex++];
          }
          remaining -= blockSize;
        } else {
          util.writeU32(dst, dIndex, compSize);
          dIndex += 4;
          for (var j = 0; j < compSize; ) {
            dst[dIndex++] = blockBuf[j++];
          }
          sIndex += blockSize;
          remaining -= blockSize;
        }
      }
      util.writeU32(dst, dIndex, 0);
      dIndex += 4;
      return dIndex;
    };
    exports2.decompress = function decompress4(src, maxSize) {
      var dst, size;
      if (maxSize === void 0) {
        maxSize = exports2.decompressBound(src);
      }
      dst = exports2.makeBuffer(maxSize);
      size = exports2.decompressFrame(src, dst);
      if (size !== maxSize) {
        dst = sliceArray(dst, 0, size);
      }
      return dst;
    };
    exports2.compress = function compress(src, maxSize) {
      var dst, size;
      if (maxSize === void 0) {
        maxSize = exports2.compressBound(src.length);
      }
      dst = exports2.makeBuffer(maxSize);
      size = exports2.compressFrame(src, dst);
      if (size !== maxSize) {
        dst = sliceArray(dst, 0, size);
      }
      return dst;
    };
  }
});

// cli/main.ts
import { appendFileSync, openAsBlob, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapIndexedReader.js
var import_crc2 = __toESM(require_src(), 1);
var import_heap_js = __toESM(require_heap_js_umd(), 1);

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/CachedReadable.js
var CachedReadable = class {
  /**
   * The underlying source of the data to be cached.
   */
  #readable;
  /**
   * Cached data. Indexed by offset request and stored as a Uint8Array.
   * If the requested size is less than the cached data, the cached data is returned as a subarray.
   * If the requested size is greater than the cached data, the a new request is made to the underlying readable.
   */
  #cache = /* @__PURE__ */ new Map();
  /**
   * The maximum size of the cache in bytes.
   */
  #maxCacheSizeBytes;
  /**
   * The current size of the cache in bytes.
   */
  #currentCacheSizeBytes = 0;
  /**
   * The size of the underlying readable.
   */
  #size;
  constructor(readable, maxCacheSizeBytes) {
    this.#readable = readable;
    this.#maxCacheSizeBytes = maxCacheSizeBytes;
  }
  async size() {
    if (this.#size == void 0) {
      this.#size = await this.#readable.size();
    }
    return this.#size;
  }
  async read(offset, size) {
    const requestedSize = Number(size);
    const cached3 = this.#cache.get(offset);
    if (cached3 != void 0 && cached3.byteLength >= requestedSize) {
      return cached3.byteLength === requestedSize ? cached3 : cached3.subarray(0, requestedSize);
    }
    const data = await this.#readable.read(offset, size);
    if (this.#currentCacheSizeBytes + data.byteLength <= this.#maxCacheSizeBytes) {
      const copy = new Uint8Array(data);
      this.#cache.set(offset, copy);
      this.#currentCacheSizeBytes += copy.byteLength;
      return copy;
    }
    return data;
  }
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/getBigUint64.js
var getBigUint64 = typeof DataView.prototype.getBigUint64 === "function" ? DataView.prototype.getBigUint64 : function(offset, littleEndian) {
  const lo = littleEndian === true ? this.getUint32(offset, littleEndian) : this.getUint32(offset + 4, littleEndian);
  const hi = littleEndian === true ? this.getUint32(offset + 4, littleEndian) : this.getUint32(offset, littleEndian);
  return BigInt(hi) << 32n | BigInt(lo);
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/Reader.js
var textDecoder = new TextDecoder();
var Reader = class {
  #view;
  #viewU8;
  offset;
  constructor(view, offset = 0) {
    this.#view = view;
    this.#viewU8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.offset = offset;
  }
  // Should be ~identical to the constructor, it allows us to reinitialize the reader when
  // the view changes,  without creating a new instance, avoiding allocation / GC overhead
  reset(view, offset = 0) {
    this.#view = view;
    this.#viewU8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.offset = offset;
  }
  bytesRemaining() {
    return this.#viewU8.length - this.offset;
  }
  uint8() {
    const value = this.#view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  uint16() {
    const value = this.#view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  uint32() {
    const value = this.#view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  uint64() {
    const value = getBigUint64.call(this.#view, this.offset, true);
    this.offset += 8;
    return value;
  }
  string() {
    const length = this.uint32();
    if (length === 0) {
      return "";
    } else if (length > this.bytesRemaining()) {
      throw new Error(`String length ${length} exceeds bounds of buffer`);
    }
    return textDecoder.decode(this.u8ArrayBorrow(length));
  }
  keyValuePairs(readKey, readValue) {
    const length = this.uint32();
    if (this.offset + length > this.#view.byteLength) {
      throw new Error(`Key-value pairs length ${length} exceeds bounds of buffer`);
    }
    const result = [];
    const endOffset = this.offset + length;
    try {
      while (this.offset < endOffset) {
        result.push([readKey(this), readValue(this)]);
      }
    } catch (err2) {
      throw new Error(`Error reading key-value pairs: ${err2.message}`);
    }
    if (this.offset !== endOffset) {
      throw new Error(`Key-value pairs length (${this.offset - endOffset + length}) greater than expected (${length})`);
    }
    return result;
  }
  map(readKey, readValue) {
    const length = this.uint32();
    if (this.offset + length > this.#view.byteLength) {
      throw new Error(`Map length ${length} exceeds bounds of buffer`);
    }
    const result = /* @__PURE__ */ new Map();
    const endOffset = this.offset + length;
    try {
      while (this.offset < endOffset) {
        const key = readKey(this);
        const value = readValue(this);
        const existingValue = result.get(key);
        if (existingValue != void 0) {
          throw new Error(`Duplicate key ${String(key)} (${String(existingValue)} vs ${String(value)})`);
        }
        result.set(key, value);
      }
    } catch (err2) {
      throw new Error(`Error reading map: ${err2.message}`);
    }
    if (this.offset !== endOffset) {
      throw new Error(`Map length (${this.offset - endOffset + length}) greater than expected (${length})`);
    }
    return result;
  }
  // Read a borrowed Uint8Array, useful temp references or borrow semantics
  u8ArrayBorrow(length) {
    const result = this.#viewU8.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  // Read a copied Uint8Array from the underlying buffer, use when you need to keep the data around
  u8ArrayCopy(length) {
    const result = this.#viewU8.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/parse.js
var import_crc = __toESM(require_src(), 1);

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/constants.js
var MCAP_MAGIC = Object.freeze([137, 77, 67, 65, 80, 48, 13, 10]);
var Opcode;
(function(Opcode2) {
  Opcode2[Opcode2["MIN"] = 1] = "MIN";
  Opcode2[Opcode2["HEADER"] = 1] = "HEADER";
  Opcode2[Opcode2["FOOTER"] = 2] = "FOOTER";
  Opcode2[Opcode2["SCHEMA"] = 3] = "SCHEMA";
  Opcode2[Opcode2["CHANNEL"] = 4] = "CHANNEL";
  Opcode2[Opcode2["MESSAGE"] = 5] = "MESSAGE";
  Opcode2[Opcode2["CHUNK"] = 6] = "CHUNK";
  Opcode2[Opcode2["MESSAGE_INDEX"] = 7] = "MESSAGE_INDEX";
  Opcode2[Opcode2["CHUNK_INDEX"] = 8] = "CHUNK_INDEX";
  Opcode2[Opcode2["ATTACHMENT"] = 9] = "ATTACHMENT";
  Opcode2[Opcode2["ATTACHMENT_INDEX"] = 10] = "ATTACHMENT_INDEX";
  Opcode2[Opcode2["STATISTICS"] = 11] = "STATISTICS";
  Opcode2[Opcode2["METADATA"] = 12] = "METADATA";
  Opcode2[Opcode2["METADATA_INDEX"] = 13] = "METADATA_INDEX";
  Opcode2[Opcode2["SUMMARY_OFFSET"] = 14] = "SUMMARY_OFFSET";
  Opcode2[Opcode2["DATA_END"] = 15] = "DATA_END";
  Opcode2[Opcode2["MAX"] = 15] = "MAX";
})(Opcode || (Opcode = {}));

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/parse.js
function parseMagic(reader) {
  if (reader.bytesRemaining() < MCAP_MAGIC.length) {
    return void 0;
  }
  const magic = reader.u8ArrayBorrow(MCAP_MAGIC.length);
  if (!MCAP_MAGIC.every((val, i) => val === magic[i])) {
    throw new Error(`Expected MCAP magic '${MCAP_MAGIC.map((val) => val.toString(16).padStart(2, "0")).join(" ")}', found '${Array.from(magic, (_, i) => magic[i].toString(16).padStart(2, "0")).join(" ")}'`);
  }
  return { specVersion: "0" };
}
function parseRecord(reader, validateCrcs = false) {
  const RECORD_HEADER_SIZE = 1 + 8;
  if (reader.bytesRemaining() < RECORD_HEADER_SIZE) {
    return void 0;
  }
  const start = reader.offset;
  const opcode = reader.uint8();
  const recordLength = reader.uint64();
  if (recordLength > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Record content length ${recordLength} is too large`);
  }
  const recordLengthNum = Number(recordLength);
  if (reader.bytesRemaining() < recordLengthNum) {
    reader.offset = start;
    return void 0;
  }
  let result;
  switch (opcode) {
    case Opcode.HEADER:
      result = parseHeader(reader, recordLengthNum);
      break;
    case Opcode.FOOTER:
      result = parseFooter(reader, recordLengthNum);
      break;
    case Opcode.SCHEMA:
      result = parseSchema(reader, recordLengthNum);
      break;
    case Opcode.CHANNEL:
      result = parseChannel(reader, recordLengthNum);
      break;
    case Opcode.MESSAGE:
      result = parseMessage(reader, recordLengthNum);
      break;
    case Opcode.CHUNK:
      result = parseChunk(reader, recordLengthNum);
      break;
    case Opcode.MESSAGE_INDEX:
      result = parseMessageIndex(reader, recordLengthNum);
      break;
    case Opcode.CHUNK_INDEX:
      result = parseChunkIndex(reader, recordLengthNum);
      break;
    case Opcode.ATTACHMENT:
      result = parseAttachment(reader, recordLengthNum, validateCrcs);
      break;
    case Opcode.ATTACHMENT_INDEX:
      result = parseAttachmentIndex(reader, recordLengthNum);
      break;
    case Opcode.STATISTICS:
      result = parseStatistics(reader, recordLengthNum);
      break;
    case Opcode.METADATA:
      result = parseMetadata(reader, recordLengthNum);
      break;
    case Opcode.METADATA_INDEX:
      result = parseMetadataIndex(reader, recordLengthNum);
      break;
    case Opcode.SUMMARY_OFFSET:
      result = parseSummaryOffset(reader, recordLengthNum);
      break;
    case Opcode.DATA_END:
      result = parseDataEnd(reader, recordLengthNum);
      break;
    default:
      result = parseUnknown(reader, recordLengthNum, opcode);
      break;
  }
  reader.offset = start + RECORD_HEADER_SIZE + recordLengthNum;
  return result;
}
function parseUnknown(reader, recordLength, opcode) {
  const data = reader.u8ArrayBorrow(recordLength);
  return {
    type: "Unknown",
    opcode,
    data
  };
}
function parseHeader(reader, recordLength) {
  const startOffset = reader.offset;
  const profile = reader.string();
  const library = reader.string();
  reader.offset = startOffset + recordLength;
  return { type: "Header", profile, library };
}
function parseFooter(reader, recordLength) {
  const startOffset = reader.offset;
  const summaryStart = reader.uint64();
  const summaryOffsetStart = reader.uint64();
  const summaryCrc = reader.uint32();
  reader.offset = startOffset + recordLength;
  return {
    type: "Footer",
    summaryStart,
    summaryOffsetStart,
    summaryCrc
  };
}
function parseSchema(reader, recordLength) {
  const start = reader.offset;
  const id = reader.uint16();
  const name = reader.string();
  const encoding = reader.string();
  const dataLen = reader.uint32();
  const end = reader.offset;
  if (recordLength - (end - start) < dataLen) {
    throw new Error(`Schema data length ${dataLen} exceeds bounds of record`);
  }
  const data = reader.u8ArrayCopy(dataLen);
  reader.offset = start + recordLength;
  return {
    type: "Schema",
    id,
    encoding,
    name,
    data
  };
}
function parseChannel(reader, recordLength) {
  const startOffset = reader.offset;
  const channelId = reader.uint16();
  const schemaId = reader.uint16();
  const topicName = reader.string();
  const messageEncoding = reader.string();
  const metadata = reader.map((r) => r.string(), (r) => r.string());
  reader.offset = startOffset + recordLength;
  return {
    type: "Channel",
    id: channelId,
    schemaId,
    topic: topicName,
    messageEncoding,
    metadata
  };
}
function parseMessage(reader, recordLength) {
  const MESSAGE_PREFIX_SIZE = 2 + 4 + 8 + 8;
  const channelId = reader.uint16();
  const sequence = reader.uint32();
  const logTime = reader.uint64();
  const publishTime = reader.uint64();
  const data = reader.u8ArrayCopy(recordLength - MESSAGE_PREFIX_SIZE);
  return {
    type: "Message",
    channelId,
    sequence,
    logTime,
    publishTime,
    data
  };
}
function parseChunk(reader, recordLength) {
  const start = reader.offset;
  const startTime = reader.uint64();
  const endTime = reader.uint64();
  const uncompressedSize = reader.uint64();
  const uncompressedCrc = reader.uint32();
  const compression = reader.string();
  const recordsByteLength = Number(reader.uint64());
  const end = reader.offset;
  const prefixSize = end - start;
  if (recordsByteLength + prefixSize > recordLength) {
    throw new Error("Chunk records length exceeds remaining record size");
  }
  const records = reader.u8ArrayCopy(recordsByteLength);
  reader.offset = start + recordLength;
  return {
    type: "Chunk",
    messageStartTime: startTime,
    messageEndTime: endTime,
    compression,
    uncompressedSize,
    uncompressedCrc,
    records
  };
}
function parseMessageIndex(reader, recordLength) {
  const startOffset = reader.offset;
  const channelId = reader.uint16();
  const records = reader.keyValuePairs((r) => r.uint64(), (r) => r.uint64());
  reader.offset = startOffset + recordLength;
  return {
    type: "MessageIndex",
    channelId,
    records
  };
}
function parseChunkIndex(reader, recordLength) {
  const startOffset = reader.offset;
  const messageStartTime = reader.uint64();
  const messageEndTime = reader.uint64();
  const chunkStartOffset = reader.uint64();
  const chunkLength = reader.uint64();
  const messageIndexOffsets = reader.map((r) => r.uint16(), (r) => r.uint64());
  const messageIndexLength = reader.uint64();
  const compression = reader.string();
  const compressedSize = reader.uint64();
  const uncompressedSize = reader.uint64();
  reader.offset = startOffset + recordLength;
  return {
    type: "ChunkIndex",
    messageStartTime,
    messageEndTime,
    chunkStartOffset,
    chunkLength,
    messageIndexOffsets,
    messageIndexLength,
    compression,
    compressedSize,
    uncompressedSize
  };
}
function parseAttachment(reader, recordLength, validateCrcs) {
  const startOffset = reader.offset;
  const logTime = reader.uint64();
  const createTime = reader.uint64();
  const name = reader.string();
  const mediaType = reader.string();
  const dataLen = reader.uint64();
  if (BigInt(reader.offset) + dataLen > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Attachment too large: ${dataLen}`);
  }
  if (reader.offset + Number(dataLen) + 4 > startOffset + recordLength) {
    throw new Error(`Attachment data length ${dataLen} exceeds bounds of record`);
  }
  const data = reader.u8ArrayCopy(Number(dataLen));
  const crcLength = reader.offset - startOffset;
  const expectedCrc = reader.uint32();
  if (validateCrcs && expectedCrc !== 0) {
    reader.offset = startOffset;
    const fullData = reader.u8ArrayBorrow(crcLength);
    const actualCrc = (0, import_crc.crc32)(fullData);
    reader.offset = startOffset + crcLength + 4;
    if (actualCrc !== expectedCrc) {
      throw new Error(`Attachment CRC32 mismatch: expected ${expectedCrc}, actual ${actualCrc}`);
    }
  }
  reader.offset = startOffset + recordLength;
  return {
    type: "Attachment",
    logTime,
    createTime,
    name,
    mediaType,
    data
  };
}
function parseAttachmentIndex(reader, recordLength) {
  const startOffset = reader.offset;
  const offset = reader.uint64();
  const length = reader.uint64();
  const logTime = reader.uint64();
  const createTime = reader.uint64();
  const dataSize = reader.uint64();
  const name = reader.string();
  const mediaType = reader.string();
  reader.offset = startOffset + recordLength;
  return {
    type: "AttachmentIndex",
    offset,
    length,
    logTime,
    createTime,
    dataSize,
    name,
    mediaType
  };
}
function parseStatistics(reader, recordLength) {
  const startOffset = reader.offset;
  const messageCount = reader.uint64();
  const schemaCount = reader.uint16();
  const channelCount = reader.uint32();
  const attachmentCount = reader.uint32();
  const metadataCount = reader.uint32();
  const chunkCount = reader.uint32();
  const messageStartTime = reader.uint64();
  const messageEndTime = reader.uint64();
  const channelMessageCounts = reader.map((r) => r.uint16(), (r) => r.uint64());
  reader.offset = startOffset + recordLength;
  return {
    type: "Statistics",
    messageCount,
    schemaCount,
    channelCount,
    attachmentCount,
    metadataCount,
    chunkCount,
    messageStartTime,
    messageEndTime,
    channelMessageCounts
  };
}
function parseMetadata(reader, recordLength) {
  const startOffset = reader.offset;
  const name = reader.string();
  const metadata = reader.map((r) => r.string(), (r) => r.string());
  reader.offset = startOffset + recordLength;
  return { type: "Metadata", metadata, name };
}
function parseMetadataIndex(reader, recordLength) {
  const startOffset = reader.offset;
  const offset = reader.uint64();
  const length = reader.uint64();
  const name = reader.string();
  reader.offset = startOffset + recordLength;
  return {
    type: "MetadataIndex",
    offset,
    length,
    name
  };
}
function parseSummaryOffset(reader, recordLength) {
  const startOffset = reader.offset;
  const groupOpcode = reader.uint8();
  const groupStart = reader.uint64();
  const groupLength = reader.uint64();
  reader.offset = startOffset + recordLength;
  return {
    type: "SummaryOffset",
    groupOpcode,
    groupStart,
    groupLength
  };
}
function parseDataEnd(reader, recordLength) {
  const startOffset = reader.offset;
  const dataSectionCrc = reader.uint32();
  reader.offset = startOffset + recordLength;
  return {
    type: "DataEnd",
    dataSectionCrc
  };
}

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/sortedIndexBy.js
function sortedIndexBy(array, value, iteratee) {
  let low = 0;
  let high = array.length;
  if (high === 0) {
    return 0;
  }
  const computedValue = iteratee(value);
  while (low < high) {
    const mid = low + high >>> 1;
    const curComputedValue = iteratee(array[mid][0]);
    if (curComputedValue < computedValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/sortedLastIndex.js
function sortedLastIndexBy(array, value, iteratee) {
  let low = 0;
  let high = array.length;
  if (high === 0) {
    return 0;
  }
  const computedValue = iteratee(value);
  while (low < high) {
    const mid = low + high >>> 1;
    const computed = iteratee(array[mid][0]);
    if (computed <= computedValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/ChunkCursor.js
var ChunkCursor = class {
  chunkIndex;
  #relevantChannels;
  #startTime;
  #endTime;
  #reverse;
  #readFullMessageIndexRange;
  // List of message offsets (across all channels) sorted by logTime.
  #orderedMessageOffsets;
  // Index for the next message offset. Gets incremented for every popMessage() call.
  #nextMessageOffsetIndex = 0;
  constructor(params) {
    this.chunkIndex = params.chunkIndex;
    this.#relevantChannels = params.relevantChannels;
    this.#startTime = params.startTime;
    this.#endTime = params.endTime;
    this.#reverse = params.reverse;
    this.#readFullMessageIndexRange = params.readFullMessageIndexRange ?? false;
    if (this.chunkIndex.messageIndexLength === 0n) {
      if (this.chunkIndex.messageStartTime !== 0n || this.chunkIndex.messageEndTime !== 0n) {
        throw new Error(`Encountered a chunk index without message indexes and non-zero start and end times`);
      }
    }
  }
  /**
   * Returns `< 0` if the callee's next available message logTime is earlier than `other`'s, `> 0`
   * for the opposite case. Never returns `0` because ties are broken by the chunks' offsets in the
   * file.
   *
   * Cursors that still need `loadMessageIndexes()` are sorted earlier so the caller can load them
   * and re-sort the cursors.
   */
  compare(other) {
    if (this.#reverse !== other.#reverse) {
      throw new Error("Cannot compare a reversed ChunkCursor to a non-reversed ChunkCursor");
    }
    let diff = Number(this.#getSortTime() - other.#getSortTime());
    if (diff === 0) {
      diff = Number(this.chunkIndex.chunkStartOffset - other.chunkIndex.chunkStartOffset);
    }
    return this.#reverse ? -diff : diff;
  }
  /**
   * Returns true if there are more messages available in the chunk. Message indexes must have been
   * loaded before using this method.
   */
  hasMoreMessages() {
    if (this.#orderedMessageOffsets == void 0) {
      throw new Error("loadMessageIndexes() must be called before hasMore()");
    }
    return this.#nextMessageOffsetIndex < this.#orderedMessageOffsets.length;
  }
  /**
   * Pop a message offset off of the chunk cursor. Message indexes must have been loaded before
   * using this method.
   */
  popMessage() {
    if (this.#orderedMessageOffsets == void 0) {
      throw new Error("loadMessageIndexes() must be called before popMessage()");
    }
    if (this.#nextMessageOffsetIndex >= this.#orderedMessageOffsets.length) {
      throw new Error(`Unexpected popMessage() call when no more messages are available, in chunk at offset ${this.chunkIndex.chunkStartOffset}`);
    }
    return this.#orderedMessageOffsets[this.#nextMessageOffsetIndex++];
  }
  /**
   * Returns true if message indexes have been loaded, false if `loadMessageIndexes()` needs to be
   * called.
   */
  hasMessageIndexes() {
    return this.#orderedMessageOffsets != void 0;
  }
  async loadMessageIndexes(readable) {
    const reverse = this.#reverse;
    let messageIndexStartOffset;
    let relevantMessageIndexStartOffset;
    const readFullRange = this.#readFullMessageIndexRange;
    for (const [channelId, offset] of this.chunkIndex.messageIndexOffsets) {
      if (messageIndexStartOffset == void 0 || offset < messageIndexStartOffset) {
        messageIndexStartOffset = offset;
      }
      if (readFullRange || !this.#relevantChannels || this.#relevantChannels.has(channelId)) {
        if (relevantMessageIndexStartOffset == void 0 || offset < relevantMessageIndexStartOffset) {
          relevantMessageIndexStartOffset = offset;
        }
      }
    }
    if (messageIndexStartOffset == void 0 || relevantMessageIndexStartOffset == void 0) {
      this.#orderedMessageOffsets = [];
      return;
    }
    const messageIndexEndOffset = messageIndexStartOffset + this.chunkIndex.messageIndexLength;
    const messageIndexes = await readable.read(relevantMessageIndexStartOffset, messageIndexEndOffset - relevantMessageIndexStartOffset);
    const messageIndexesView = new DataView(messageIndexes.buffer, messageIndexes.byteOffset, messageIndexes.byteLength);
    const reader = new Reader(messageIndexesView);
    const arrayOfMessageOffsets = [];
    let record;
    while (record = parseRecord(reader, true)) {
      if (record.type !== "MessageIndex") {
        continue;
      }
      if (record.records.length === 0 || this.#relevantChannels && !this.#relevantChannels.has(record.channelId)) {
        continue;
      }
      arrayOfMessageOffsets.push(record.records);
    }
    if (reader.bytesRemaining() !== 0) {
      throw new Error(`${reader.bytesRemaining()} bytes remaining in message index section`);
    }
    this.#orderedMessageOffsets = arrayOfMessageOffsets.flat().sort(([logTimeA, offsetA], [logTimeB, offsetB]) => {
      let diff = Number(logTimeA - logTimeB);
      if (diff === 0) {
        diff = Number(offsetA - offsetB);
      }
      return diff;
    });
    if (reverse) {
      this.#orderedMessageOffsets.reverse();
    }
    if (this.#orderedMessageOffsets.length === 0) {
      return;
    }
    const [logTimeFirstMessage] = this.#orderedMessageOffsets[0];
    if (logTimeFirstMessage < this.chunkIndex.messageStartTime) {
      throw new Error(`Chunk at offset ${this.chunkIndex.chunkStartOffset} contains a message with logTime (${logTimeFirstMessage}) earlier than chunk messageStartTime (${this.chunkIndex.messageStartTime})`);
    }
    const [logTimeLastMessage] = this.#orderedMessageOffsets[this.#orderedMessageOffsets.length - 1];
    if (logTimeLastMessage > this.chunkIndex.messageEndTime) {
      throw new Error(`Chunk at offset ${this.chunkIndex.chunkStartOffset} contains a message with logTime (${logTimeLastMessage}) later than chunk messageEndTime (${this.chunkIndex.messageEndTime})`);
    }
    const startTime = reverse ? this.#endTime : this.#startTime;
    const endTime = reverse ? this.#startTime : this.#endTime;
    const iteratee = reverse ? (logTime) => -logTime : (logTime) => logTime;
    let startIndex;
    let endIndex;
    if (startTime != void 0) {
      startIndex = sortedIndexBy(this.#orderedMessageOffsets, startTime, iteratee);
    }
    if (endTime != void 0) {
      endIndex = sortedLastIndexBy(this.#orderedMessageOffsets, endTime, iteratee);
    }
    if (startIndex != void 0 || endIndex != void 0) {
      this.#orderedMessageOffsets = this.#orderedMessageOffsets.slice(startIndex, endIndex);
    }
  }
  // Get the next available message logTime which is being used when comparing chunkCursors (for ordering purposes).
  #getSortTime() {
    if (this.#orderedMessageOffsets != void 0 && this.#orderedMessageOffsets.length > 0 && this.#nextMessageOffsetIndex < this.#orderedMessageOffsets.length) {
      return this.#orderedMessageOffsets[this.#nextMessageOffsetIndex][0];
    }
    return this.#reverse ? this.chunkIndex.messageEndTime : this.chunkIndex.messageStartTime;
  }
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapIndexedReader.js
var McapIndexedReader = class _McapIndexedReader {
  chunkIndexes;
  attachmentIndexes;
  metadataIndexes = [];
  channelsById;
  schemasById;
  statistics;
  summaryOffsetsByOpcode;
  header;
  footer;
  // Used for appending attachments/metadata to existing MCAP files
  dataEndOffset;
  dataSectionCrc;
  #readable;
  #messageIndexReadable;
  #decompressHandlers;
  #messageStartTime;
  #messageEndTime;
  #attachmentStartTime;
  #attachmentEndTime;
  constructor(args) {
    this.#readable = args.readable;
    this.chunkIndexes = args.chunkIndexes;
    this.attachmentIndexes = args.attachmentIndexes;
    this.metadataIndexes = args.metadataIndexes;
    this.statistics = args.statistics;
    this.#decompressHandlers = args.decompressHandlers;
    this.channelsById = args.channelsById;
    this.schemasById = args.schemasById;
    this.summaryOffsetsByOpcode = args.summaryOffsetsByOpcode;
    this.header = args.header;
    this.footer = args.footer;
    this.dataEndOffset = args.dataEndOffset;
    this.dataSectionCrc = args.dataSectionCrc;
    const messageIndexCacheSizeBytes = args.messageIndexCacheSizeBytes ?? 0;
    this.#messageIndexReadable = messageIndexCacheSizeBytes > 0 ? new CachedReadable(this.#readable, messageIndexCacheSizeBytes) : this.#readable;
    for (const chunk of args.chunkIndexes) {
      if (this.#messageStartTime == void 0 || chunk.messageStartTime < this.#messageStartTime) {
        this.#messageStartTime = chunk.messageStartTime;
      }
      if (this.#messageEndTime == void 0 || chunk.messageEndTime > this.#messageEndTime) {
        this.#messageEndTime = chunk.messageEndTime;
      }
    }
    for (const attachment of args.attachmentIndexes) {
      if (this.#attachmentStartTime == void 0 || attachment.logTime < this.#attachmentStartTime) {
        this.#attachmentStartTime = attachment.logTime;
      }
      if (this.#attachmentEndTime == void 0 || attachment.logTime > this.#attachmentEndTime) {
        this.#attachmentEndTime = attachment.logTime;
      }
    }
  }
  #errorWithLibrary(message) {
    return new Error(`${message} [library=${this.header.library}]`);
  }
  static async Initialize({ readable, decompressHandlers, messageIndexCacheSizeBytes }) {
    const size = await readable.size();
    let header;
    let headerEndOffset;
    {
      const headerPrefix = await readable.read(0n, BigInt(MCAP_MAGIC.length + /* Opcode.HEADER */
      1 + /* record content length */
      8));
      const headerPrefixView = new DataView(headerPrefix.buffer, headerPrefix.byteOffset, headerPrefix.byteLength);
      void parseMagic(new Reader(headerPrefixView));
      const headerContentLength = headerPrefixView.getBigUint64(MCAP_MAGIC.length + /* Opcode.HEADER */
      1, true);
      const headerReadLength = (
        /* Opcode.HEADER */
        1n + /* record content length */
        8n + headerContentLength
      );
      const headerRecord = await readable.read(BigInt(MCAP_MAGIC.length), headerReadLength);
      headerEndOffset = BigInt(MCAP_MAGIC.length) + headerReadLength;
      const headerReader = new Reader(new DataView(headerRecord.buffer, headerRecord.byteOffset, headerRecord.byteLength));
      const headerResult = parseRecord(headerReader, true);
      if (headerResult?.type !== "Header") {
        throw new Error(`Unable to read header at beginning of file; found ${headerResult?.type ?? "nothing"}`);
      }
      if (headerReader.bytesRemaining() !== 0) {
        throw new Error(`${headerReader.bytesRemaining()} bytes remaining after parsing header`);
      }
      header = headerResult;
    }
    function errorWithLibrary(message) {
      return new Error(`${message} [library=${header.library}]`);
    }
    let footerOffset;
    let footerAndMagicView;
    {
      const headerLengthLowerBound = BigInt(MCAP_MAGIC.length + /* Opcode.HEADER */
      1 + /* record content length */
      8 + /* profile length */
      4 + /* library length */
      4);
      const footerAndMagicReadLength = BigInt(
        /* Opcode.FOOTER */
        1 + /* record content length */
        8 + /* summaryStart */
        8 + /* summaryOffsetStart */
        8 + /* crc */
        4 + MCAP_MAGIC.length
      );
      if (size < headerLengthLowerBound + footerAndMagicReadLength) {
        throw errorWithLibrary(`File size (${size}) is too small to be valid MCAP`);
      }
      footerOffset = size - footerAndMagicReadLength;
      const footerBuffer = await readable.read(footerOffset, footerAndMagicReadLength);
      footerAndMagicView = new DataView(footerBuffer.buffer, footerBuffer.byteOffset, footerBuffer.byteLength);
    }
    try {
      void parseMagic(new Reader(footerAndMagicView, footerAndMagicView.byteLength - MCAP_MAGIC.length));
    } catch (error) {
      throw errorWithLibrary(error.message);
    }
    let footer;
    {
      const footerReader = new Reader(footerAndMagicView);
      const footerRecord = parseRecord(footerReader, true);
      if (footerRecord?.type !== "Footer") {
        throw errorWithLibrary(`Unable to read footer from end of file (offset ${footerOffset}); found ${footerRecord?.type ?? "nothing"}`);
      }
      if (footerReader.bytesRemaining() !== MCAP_MAGIC.length) {
        throw errorWithLibrary(`${footerReader.bytesRemaining() - MCAP_MAGIC.length} bytes remaining after parsing footer`);
      }
      footer = footerRecord;
    }
    if (footer.summaryStart === 0n) {
      throw errorWithLibrary("File is not indexed");
    }
    const footerPrefix = new Uint8Array(
      /* Opcode.FOOTER */
      1 + /* record content length */
      8 + /* summary start */
      8 + /* summary offset start */
      8
    );
    footerPrefix.set(new Uint8Array(footerAndMagicView.buffer, footerAndMagicView.byteOffset, footerPrefix.byteLength));
    const dataEndLength = (
      /* Opcode.DATA_END */
      1n + /* record content length */
      8n + /* data_section_crc */
      4n
    );
    const dataEndOffset = footer.summaryStart - dataEndLength;
    if (dataEndOffset < headerEndOffset) {
      throw errorWithLibrary(`Expected DataEnd position (summary start ${footer.summaryStart} - ${dataEndLength} = ${dataEndOffset}) to be after Header end offset (${headerEndOffset})`);
    }
    const dataEndAndSummarySection = await readable.read(dataEndOffset, footerOffset - dataEndOffset);
    if (footer.summaryCrc !== 0) {
      let summaryCrc = (0, import_crc2.crc32Init)();
      summaryCrc = (0, import_crc2.crc32Update)(summaryCrc, dataEndAndSummarySection.subarray(Number(dataEndLength)));
      summaryCrc = (0, import_crc2.crc32Update)(summaryCrc, footerPrefix);
      summaryCrc = (0, import_crc2.crc32Final)(summaryCrc);
      if (summaryCrc !== footer.summaryCrc) {
        throw errorWithLibrary(`Incorrect summary CRC ${summaryCrc} (expected ${footer.summaryCrc})`);
      }
    }
    const indexView = new DataView(dataEndAndSummarySection.buffer, dataEndAndSummarySection.byteOffset, dataEndAndSummarySection.byteLength);
    const indexReader = new Reader(indexView);
    const channelsById = /* @__PURE__ */ new Map();
    const schemasById = /* @__PURE__ */ new Map();
    const chunkIndexes = [];
    const attachmentIndexes = [];
    const metadataIndexes = [];
    const summaryOffsetsByOpcode = /* @__PURE__ */ new Map();
    let statistics;
    let dataSectionCrc;
    let first = true;
    let result;
    while (result = parseRecord(indexReader, true)) {
      if (first && result.type !== "DataEnd") {
        throw errorWithLibrary(`Expected DataEnd record to precede summary section, but found ${result.type}`);
      }
      first = false;
      switch (result.type) {
        case "Schema":
          schemasById.set(result.id, result);
          break;
        case "Channel":
          channelsById.set(result.id, result);
          break;
        case "ChunkIndex":
          chunkIndexes.push(result);
          break;
        case "AttachmentIndex":
          attachmentIndexes.push(result);
          break;
        case "MetadataIndex":
          metadataIndexes.push(result);
          break;
        case "Statistics":
          if (statistics) {
            throw errorWithLibrary("Duplicate Statistics record");
          }
          statistics = result;
          break;
        case "SummaryOffset":
          summaryOffsetsByOpcode.set(result.groupOpcode, result);
          break;
        case "DataEnd":
          dataSectionCrc = result.dataSectionCrc === 0 ? void 0 : result.dataSectionCrc;
          break;
        case "Header":
        case "Footer":
        case "Message":
        case "Chunk":
        case "MessageIndex":
        case "Attachment":
        case "Metadata":
          throw errorWithLibrary(`${result.type} record not allowed in index section`);
        case "Unknown":
          break;
      }
    }
    if (indexReader.bytesRemaining() !== 0) {
      throw errorWithLibrary(`${indexReader.bytesRemaining()} bytes remaining in index section`);
    }
    return new _McapIndexedReader({
      readable,
      chunkIndexes,
      attachmentIndexes,
      metadataIndexes,
      statistics,
      decompressHandlers,
      channelsById,
      schemasById,
      summaryOffsetsByOpcode,
      header,
      footer,
      dataEndOffset,
      dataSectionCrc,
      messageIndexCacheSizeBytes
    });
  }
  async *readMessages(args = {}) {
    const { topics, startTime = this.#messageStartTime, endTime = this.#messageEndTime, reverse = false, validateCrcs } = args;
    if (startTime == void 0 || endTime == void 0) {
      return;
    }
    let relevantChannels;
    if (topics) {
      relevantChannels = /* @__PURE__ */ new Set();
      for (const channel of this.channelsById.values()) {
        if (topics.includes(channel.topic)) {
          relevantChannels.add(channel.id);
        }
      }
    }
    const chunkCursors = new import_heap_js.Heap((a, b) => a.compare(b));
    let chunksOrdered = true;
    let prevChunkEndTime;
    const readFullMessageIndexRange = this.#messageIndexReadable !== this.#readable;
    for (const chunkIndex of this.chunkIndexes) {
      if (chunkIndex.messageStartTime <= endTime && chunkIndex.messageEndTime >= startTime) {
        chunkCursors.push(new ChunkCursor({
          chunkIndex,
          relevantChannels,
          startTime,
          endTime,
          reverse,
          readFullMessageIndexRange
        }));
        if (chunksOrdered && prevChunkEndTime != void 0) {
          chunksOrdered = chunkIndex.messageStartTime >= prevChunkEndTime;
        }
        prevChunkEndTime = chunkIndex.messageEndTime;
      }
    }
    const chunkViewCache = /* @__PURE__ */ new Map();
    const chunkReader = new Reader(new DataView(new ArrayBuffer(0)));
    for (let cursor; cursor = chunkCursors.peek(); ) {
      if (!cursor.hasMessageIndexes()) {
        await cursor.loadMessageIndexes(this.#messageIndexReadable);
        if (cursor.hasMoreMessages()) {
          chunkCursors.replace(cursor);
        } else {
          chunkCursors.pop();
        }
        continue;
      }
      let chunkView = chunkViewCache.get(cursor.chunkIndex.chunkStartOffset);
      if (!chunkView) {
        chunkView = await this.#loadChunkData(cursor.chunkIndex, {
          validateCrcs: validateCrcs ?? true
        });
        chunkViewCache.set(cursor.chunkIndex.chunkStartOffset, chunkView);
      }
      const [logTime, offset] = cursor.popMessage();
      if (offset >= BigInt(chunkView.byteLength)) {
        throw this.#errorWithLibrary(`Message offset beyond chunk bounds (log time ${logTime}, offset ${offset}, chunk data length ${chunkView.byteLength}) in chunk at offset ${cursor.chunkIndex.chunkStartOffset}`);
      }
      chunkReader.reset(chunkView, Number(offset));
      const record = parseRecord(chunkReader, validateCrcs ?? true);
      if (!record) {
        throw this.#errorWithLibrary(`Unable to parse record at offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset}`);
      }
      if (record.type !== "Message") {
        throw this.#errorWithLibrary(`Unexpected record type ${record.type} in message index (time ${logTime}, offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset})`);
      }
      if (record.logTime !== logTime) {
        throw this.#errorWithLibrary(`Message log time ${record.logTime} did not match message index entry (${logTime} at offset ${offset} in chunk at offset ${cursor.chunkIndex.chunkStartOffset})`);
      }
      yield record;
      if (cursor.hasMoreMessages()) {
        if (!chunksOrdered) {
          chunkCursors.replace(cursor);
        }
      } else {
        chunkCursors.pop();
        chunkViewCache.delete(cursor.chunkIndex.chunkStartOffset);
      }
    }
  }
  async *readMetadata(args = {}) {
    const { name } = args;
    for (const metadataIndex of this.metadataIndexes) {
      if (name != void 0 && metadataIndex.name !== name) {
        continue;
      }
      const metadataData = await this.#readable.read(metadataIndex.offset, metadataIndex.length);
      const metadataReader = new Reader(new DataView(metadataData.buffer, metadataData.byteOffset, metadataData.byteLength));
      const metadataRecord = parseRecord(metadataReader, false);
      if (metadataRecord?.type !== "Metadata") {
        throw this.#errorWithLibrary(`Metadata data at offset ${metadataIndex.offset} does not point to metadata record (found ${String(metadataRecord?.type)})`);
      }
      yield metadataRecord;
    }
  }
  async *readAttachments(args = {}) {
    const { name, mediaType, startTime = this.#attachmentStartTime, endTime = this.#attachmentEndTime, validateCrcs } = args;
    if (startTime == void 0 || endTime == void 0) {
      return;
    }
    for (const attachmentIndex of this.attachmentIndexes) {
      if (name != void 0 && attachmentIndex.name !== name) {
        continue;
      }
      if (mediaType != void 0 && attachmentIndex.mediaType !== mediaType) {
        continue;
      }
      if (attachmentIndex.logTime > endTime || attachmentIndex.logTime < startTime) {
        continue;
      }
      const attachmentData = await this.#readable.read(attachmentIndex.offset, attachmentIndex.length);
      const attachmentReader = new Reader(new DataView(attachmentData.buffer, attachmentData.byteOffset, attachmentData.byteLength));
      const attachmentRecord = parseRecord(attachmentReader, validateCrcs ?? true);
      if (attachmentRecord?.type !== "Attachment") {
        throw this.#errorWithLibrary(`Attachment data at offset ${attachmentIndex.offset} does not point to attachment record (found ${String(attachmentRecord?.type)})`);
      }
      yield attachmentRecord;
    }
  }
  async #loadChunkData(chunkIndex, options) {
    const chunkData = await this.#readable.read(chunkIndex.chunkStartOffset, chunkIndex.chunkLength);
    const chunkReader = new Reader(new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength));
    const chunkRecord = parseRecord(chunkReader, options?.validateCrcs ?? true);
    if (chunkRecord?.type !== "Chunk") {
      throw this.#errorWithLibrary(`Chunk start offset ${chunkIndex.chunkStartOffset} does not point to chunk record (found ${String(chunkRecord?.type)})`);
    }
    const chunk = chunkRecord;
    let buffer = chunk.records;
    if (chunk.compression !== "" && buffer.byteLength > 0) {
      const decompress4 = this.#decompressHandlers?.[chunk.compression];
      if (!decompress4) {
        throw this.#errorWithLibrary(`Unsupported compression ${chunk.compression}`);
      }
      buffer = decompress4(buffer, chunk.uncompressedSize);
    }
    if (chunk.uncompressedCrc !== 0 && options?.validateCrcs !== false) {
      const chunkCrc = (0, import_crc2.crc32)(buffer);
      if (chunkCrc !== chunk.uncompressedCrc) {
        throw this.#errorWithLibrary(`Incorrect chunk CRC ${chunkCrc} (expected ${chunk.uncompressedCrc})`);
      }
    }
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapStreamReader.js
var import_crc3 = __toESM(require_src(), 1);
var McapStreamReader = class {
  #buffer = new ArrayBuffer(MCAP_MAGIC.length * 2);
  #view = new DataView(this.#buffer, 0, 0);
  #reader = new Reader(this.#view);
  #decompressHandlers;
  #includeChunks;
  #validateCrcs;
  #noMagicPrefix;
  #doneReading = false;
  #generator = this.#read();
  #channelsById = /* @__PURE__ */ new Map();
  constructor({ includeChunks = false, decompressHandlers = {}, validateCrcs = true, noMagicPrefix = false } = {}) {
    this.#includeChunks = includeChunks;
    this.#decompressHandlers = decompressHandlers;
    this.#validateCrcs = validateCrcs;
    this.#noMagicPrefix = noMagicPrefix;
  }
  /** @returns True if a valid, complete mcap file has been parsed. */
  done() {
    return this.#doneReading;
  }
  /** @returns The number of bytes that have been received by `append()` but not yet parsed. */
  bytesRemaining() {
    return this.#reader.bytesRemaining();
  }
  /**
   * Provide the reader with newly received bytes for it to process. After calling this function,
   * call `nextRecord()` again to parse any records that are now available.
   */
  append(data) {
    if (this.#doneReading) {
      throw new Error("Already done reading");
    }
    this.#appendOrShift(data);
  }
  #appendOrShift(data) {
    const consumedBytes = this.#reader.offset;
    const unconsumedBytes = this.#view.byteLength - consumedBytes;
    const neededCapacity = unconsumedBytes + data.byteLength;
    if (neededCapacity <= this.#buffer.byteLength) {
      if (this.#view.byteOffset + this.#view.byteLength + data.byteLength <= this.#buffer.byteLength) {
        const array = new Uint8Array(this.#buffer, this.#view.byteOffset);
        array.set(data, this.#view.byteLength);
        this.#view = new DataView(this.#buffer, this.#view.byteOffset, this.#view.byteLength + data.byteLength);
        this.#reader.reset(this.#view, this.#reader.offset);
      } else {
        const existingData = new Uint8Array(this.#buffer, this.#view.byteOffset + consumedBytes, unconsumedBytes);
        const array = new Uint8Array(this.#buffer);
        array.set(existingData, 0);
        array.set(data, existingData.byteLength);
        this.#view = new DataView(this.#buffer, 0, existingData.byteLength + data.byteLength);
        this.#reader.reset(this.#view);
      }
    } else {
      this.#buffer = new ArrayBuffer(neededCapacity * 2);
      const array = new Uint8Array(this.#buffer);
      const existingData = new Uint8Array(this.#view.buffer, this.#view.byteOffset + consumedBytes, unconsumedBytes);
      array.set(existingData, 0);
      array.set(data, existingData.byteLength);
      this.#view = new DataView(this.#buffer, 0, existingData.byteLength + data.byteLength);
      this.#reader.reset(this.#view);
    }
  }
  /**
   * Read the next record from the stream if possible. If not enough data is available to parse a
   * complete record, or if the reading has terminated with a valid footer, returns undefined.
   *
   * This function may throw any errors encountered during parsing. If an error is thrown, the
   * reader is in an unspecified state and should no longer be used.
   */
  nextRecord() {
    if (this.#doneReading) {
      return void 0;
    }
    const result = this.#generator.next();
    if (result.value?.type === "Channel") {
      const existing = this.#channelsById.get(result.value.id);
      this.#channelsById.set(result.value.id, result.value);
      if (existing && !isChannelEqual(existing, result.value)) {
        throw new Error(`Channel record for id ${result.value.id} (topic: ${result.value.topic}) differs from previous channel record of the same id.`);
      }
    } else if (result.value?.type === "Message") {
      const channelId = result.value.channelId;
      const existing = this.#channelsById.get(channelId);
      if (!existing) {
        throw new Error(`Encountered message on channel ${channelId} without prior channel record`);
      }
    }
    if (result.done === true) {
      this.#doneReading = true;
    }
    return result.value;
  }
  *#read() {
    if (!this.#noMagicPrefix) {
      let magic;
      while (magic = parseMagic(this.#reader), !magic) {
        yield;
      }
    }
    let header;
    function errorWithLibrary(message) {
      return new Error(`${message} ${header ? `[library=${header.library}]` : "[no header]"}`);
    }
    for (; ; ) {
      let record;
      while (record = parseRecord(this.#reader, this.#validateCrcs), !record) {
        yield;
      }
      switch (record.type) {
        case "Header":
          if (header) {
            throw new Error(`Duplicate Header record: library=${header.library} profile=${header.profile} vs. library=${record.library} profile=${record.profile}`);
          }
          header = record;
          yield record;
          break;
        case "Unknown":
        case "Schema":
        case "Channel":
        case "Message":
        case "MessageIndex":
        case "ChunkIndex":
        case "Attachment":
        case "AttachmentIndex":
        case "Statistics":
        case "Metadata":
        case "MetadataIndex":
        case "SummaryOffset":
        case "DataEnd":
          yield record;
          break;
        case "Chunk": {
          if (this.#includeChunks) {
            yield record;
          }
          let buffer = record.records;
          if (record.compression !== "" && buffer.byteLength > 0) {
            const decompress4 = this.#decompressHandlers[record.compression];
            if (!decompress4) {
              throw errorWithLibrary(`Unsupported compression ${record.compression}`);
            }
            buffer = decompress4(buffer, record.uncompressedSize);
          }
          if (this.#validateCrcs && record.uncompressedCrc !== 0) {
            const chunkCrc = (0, import_crc3.crc32)(buffer);
            if (chunkCrc !== record.uncompressedCrc) {
              throw errorWithLibrary(`Incorrect chunk CRC ${chunkCrc} (expected ${record.uncompressedCrc})`);
            }
          }
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          const chunkReader = new Reader(view);
          let chunkRecord;
          while (chunkRecord = parseRecord(chunkReader, this.#validateCrcs)) {
            switch (chunkRecord.type) {
              case "Header":
              case "Footer":
              case "Chunk":
              case "MessageIndex":
              case "ChunkIndex":
              case "Attachment":
              case "AttachmentIndex":
              case "Statistics":
              case "Metadata":
              case "MetadataIndex":
              case "SummaryOffset":
              case "DataEnd":
                throw errorWithLibrary(`${chunkRecord.type} record not allowed inside a chunk`);
              case "Unknown":
              case "Schema":
              case "Channel":
              case "Message":
                yield chunkRecord;
                break;
            }
          }
          if (chunkReader.bytesRemaining() !== 0) {
            throw errorWithLibrary(`${chunkReader.bytesRemaining()} bytes remaining in chunk`);
          }
          break;
        }
        case "Footer":
          try {
            let magic;
            while (magic = parseMagic(this.#reader), !magic) {
              yield;
            }
          } catch (error) {
            throw errorWithLibrary(error.message);
          }
          if (this.#reader.bytesRemaining() !== 0) {
            throw errorWithLibrary(`${this.#reader.bytesRemaining()} bytes remaining after MCAP footer and trailing magic`);
          }
          return record;
      }
    }
  }
};
function isChannelEqual(a, b) {
  if (!(a.id === b.id && a.messageEncoding === b.messageEncoding && a.schemaId === b.schemaId && a.topic === b.topic && a.metadata.size === b.metadata.size)) {
    return false;
  }
  for (const [keyA, valueA] of a.metadata.entries()) {
    const valueB = b.metadata.get(keyA);
    if (valueA !== valueB) {
      return false;
    }
  }
  return true;
}

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapWriter.js
var import_crc5 = __toESM(require_src(), 1);

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapRecordBuilder.js
var import_crc4 = __toESM(require_src(), 1);

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/BufferBuilder.js
var LITTLE_ENDIAN = true;
var BufferBuilder = class {
  #fullBuffer = new Uint8Array(4096);
  #view;
  #textEncoder = new TextEncoder();
  // location of the write head - new writes will start here
  #offset = 0;
  constructor() {
    this.#view = new DataView(this.#fullBuffer.buffer);
  }
  /**
   * Length in bytes of the written buffer
   */
  get length() {
    return this.#offset;
  }
  /** Returns a copy of the written data. */
  get buffer() {
    return this.#fullBuffer.slice(0, this.#offset);
  }
  /** Returns a temporary view into the underlying buffer (not a copy). */
  bufferView(byteOffset, byteLength) {
    return new Uint8Array(this.#fullBuffer.buffer, byteOffset, byteLength);
  }
  int8(value) {
    this.#ensureAdditionalCapacity(1);
    this.#view.setInt8(this.#offset, value);
    this.#offset += 1;
    return this;
  }
  uint8(value) {
    this.#ensureAdditionalCapacity(1);
    this.#view.setUint8(this.#offset, value);
    this.#offset += 1;
    return this;
  }
  int16(value) {
    this.#ensureAdditionalCapacity(2);
    this.#view.setInt16(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 2;
    return this;
  }
  uint16(value) {
    this.#ensureAdditionalCapacity(2);
    this.#view.setUint16(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 2;
    return this;
  }
  int32(value) {
    this.#ensureAdditionalCapacity(4);
    this.#view.setInt32(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 4;
    return this;
  }
  uint32(value) {
    this.#ensureAdditionalCapacity(4);
    this.#view.setUint32(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 4;
    return this;
  }
  int64(value) {
    this.#ensureAdditionalCapacity(8);
    this.#view.setBigInt64(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 8;
    return this;
  }
  uint64(value) {
    this.#ensureAdditionalCapacity(8);
    this.#view.setBigUint64(this.#offset, value, LITTLE_ENDIAN);
    this.#offset += 8;
    return this;
  }
  string(value) {
    const stringBytes = this.#textEncoder.encode(value);
    this.#ensureAdditionalCapacity(stringBytes.byteLength + 4);
    this.uint32(stringBytes.length);
    this.#fullBuffer.set(stringBytes, this.#offset);
    this.#offset += stringBytes.length;
    return this;
  }
  bytes(buffer) {
    this.#ensureAdditionalCapacity(buffer.byteLength);
    this.#fullBuffer.set(buffer, this.#offset);
    this.#offset += buffer.length;
    return this;
  }
  tupleArray(write1, write2, array) {
    const sizeOffset = this.#offset;
    this.uint32(0);
    for (const [key, value] of array) {
      write1.call(this, key);
      write2.call(this, value);
    }
    const currentOffset = this.#offset;
    this.#offset = sizeOffset;
    const byteLength = currentOffset - sizeOffset - 4;
    this.uint32(byteLength);
    this.#offset = currentOffset;
    return this;
  }
  /**
   * Move the write head to offset bytes from the start of the buffer.
   *
   * If the buffer is smaller than the new offset location, the buffer expands.
   */
  seek(offset) {
    this.#ensureCapacity(offset);
    this.#offset = offset;
    return this;
  }
  /**
   * reset the write head to the start of the buffer
   */
  reset() {
    this.#offset = 0;
    return this;
  }
  #ensureAdditionalCapacity(capacity) {
    this.#ensureCapacity(this.#offset + capacity);
  }
  #ensureCapacity(capacity) {
    if (capacity > this.#fullBuffer.byteLength) {
      const newSize = Math.max(this.#fullBuffer.byteLength * 1.5, capacity);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.#fullBuffer);
      this.#fullBuffer = newBuffer;
      this.#view = new DataView(this.#fullBuffer.buffer);
    }
  }
};

// node_modules/.pnpm/@mcap+core@2.2.1/node_modules/@mcap/core/dist/esm/McapRecordBuilder.js
var McapRecordBuilder = class {
  options;
  #bufferBuilder = new BufferBuilder();
  constructor(options) {
    this.options = options;
  }
  get length() {
    return this.#bufferBuilder.length;
  }
  get buffer() {
    return this.#bufferBuilder.buffer;
  }
  reset() {
    this.#bufferBuilder.reset();
  }
  writeMagic() {
    this.#bufferBuilder.bytes(new Uint8Array(MCAP_MAGIC));
  }
  writeHeader(header) {
    this.#bufferBuilder.uint8(Opcode.HEADER);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).string(header.profile).string(header.library);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeFooter(footer) {
    this.#bufferBuilder.uint8(Opcode.FOOTER).uint64(20n).uint64(footer.summaryStart).uint64(footer.summaryOffsetStart).uint32(footer.summaryCrc);
    return 20n;
  }
  writeSchema(schema) {
    this.#bufferBuilder.uint8(Opcode.SCHEMA);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint16(schema.id).string(schema.name).string(schema.encoding).uint32(schema.data.byteLength).bytes(schema.data);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeChannel(info) {
    this.#bufferBuilder.uint8(Opcode.CHANNEL);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint16(info.id).uint16(info.schemaId).string(info.topic).string(info.messageEncoding).tupleArray((key) => this.#bufferBuilder.string(key), (value) => this.#bufferBuilder.string(value), info.metadata);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeMessage(message) {
    this.#bufferBuilder.uint8(Opcode.MESSAGE);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint16(message.channelId).uint32(message.sequence).uint64(message.logTime).uint64(message.publishTime).bytes(message.data);
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
  }
  writeAttachment(attachment) {
    this.#bufferBuilder.uint8(Opcode.ATTACHMENT);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n);
    const crcStartPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(attachment.logTime).uint64(attachment.createTime).string(attachment.name).string(attachment.mediaType).uint64(BigInt(attachment.data.byteLength)).bytes(attachment.data);
    this.#bufferBuilder.uint32((0, import_crc4.crc32)(this.#bufferBuilder.bufferView(crcStartPosition, this.#bufferBuilder.length - crcStartPosition)));
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeAttachmentIndex(attachmentIndex) {
    this.#bufferBuilder.uint8(Opcode.ATTACHMENT_INDEX);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint64(attachmentIndex.offset).uint64(attachmentIndex.length).uint64(attachmentIndex.logTime).uint64(attachmentIndex.createTime).uint64(attachmentIndex.dataSize).string(attachmentIndex.name).string(attachmentIndex.mediaType);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeChunk(chunk) {
    this.#bufferBuilder.uint8(Opcode.CHUNK);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint64(chunk.messageStartTime).uint64(chunk.messageEndTime).uint64(chunk.uncompressedSize).uint32(chunk.uncompressedCrc).string(chunk.compression).uint64(BigInt(chunk.records.byteLength)).bytes(chunk.records);
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeChunkIndex(chunkIndex) {
    this.#bufferBuilder.uint8(Opcode.CHUNK_INDEX);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint64(chunkIndex.messageStartTime).uint64(chunkIndex.messageEndTime).uint64(chunkIndex.chunkStartOffset).uint64(chunkIndex.chunkLength).uint32(chunkIndex.messageIndexOffsets.size * 10);
    for (const [channelId, offset] of chunkIndex.messageIndexOffsets) {
      this.#bufferBuilder.uint16(channelId).uint64(offset);
    }
    this.#bufferBuilder.uint64(chunkIndex.messageIndexLength).string(chunkIndex.compression).uint64(chunkIndex.compressedSize).uint64(chunkIndex.uncompressedSize);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeMessageIndex(messageIndex) {
    this.#bufferBuilder.uint8(Opcode.MESSAGE_INDEX);
    const startPosition = this.#bufferBuilder.length;
    const messageIndexRecordsByteLength = messageIndex.records.length * 16;
    this.#bufferBuilder.uint64(0n).uint16(messageIndex.channelId).uint32(messageIndexRecordsByteLength);
    for (const record of messageIndex.records) {
      this.#bufferBuilder.uint64(record[0]).uint64(record[1]);
    }
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeMetadata(metadata) {
    this.#bufferBuilder.uint8(Opcode.METADATA);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).string(metadata.name).tupleArray((key) => this.#bufferBuilder.string(key), (value) => this.#bufferBuilder.string(value), metadata.metadata);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeMetadataIndex(metadataIndex) {
    this.#bufferBuilder.uint8(Opcode.METADATA_INDEX);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint64(metadataIndex.offset).uint64(metadataIndex.length).string(metadataIndex.name);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeSummaryOffset(summaryOffset) {
    this.#bufferBuilder.uint8(Opcode.SUMMARY_OFFSET);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint8(summaryOffset.groupOpcode).uint64(summaryOffset.groupStart).uint64(summaryOffset.groupLength);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeStatistics(statistics) {
    this.#bufferBuilder.uint8(Opcode.STATISTICS);
    const startPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.uint64(0n).uint64(statistics.messageCount).uint16(statistics.schemaCount).uint32(statistics.channelCount).uint32(statistics.attachmentCount).uint32(statistics.metadataCount).uint32(statistics.chunkCount).uint64(statistics.messageStartTime).uint64(statistics.messageEndTime).tupleArray((key) => this.#bufferBuilder.uint16(key), (value) => this.#bufferBuilder.uint64(value), statistics.channelMessageCounts);
    if (this.options?.padRecords === true) {
      this.#bufferBuilder.uint8(1).uint8(255).uint8(255);
    }
    const endPosition = this.#bufferBuilder.length;
    this.#bufferBuilder.seek(startPosition).uint64(BigInt(endPosition - startPosition - 8)).seek(endPosition);
    return BigInt(endPosition - startPosition + 1);
  }
  writeDataEnd(dataEnd) {
    this.#bufferBuilder.uint8(Opcode.DATA_END).uint64(4n).uint32(dataEnd.dataSectionCrc);
    return 4n;
  }
};

// node_modules/.pnpm/@mcap+browser@1.1.0/node_modules/@mcap/browser/dist/esm/BlobReadable.js
var BlobReadable = class {
  #blob;
  constructor(blob) {
    this.#blob = blob;
  }
  async size() {
    return BigInt(this.#blob.size);
  }
  async read(offset, size) {
    if (offset + size > this.#blob.size) {
      throw new Error(`Read of ${size} bytes at offset ${offset} exceeds file size ${this.#blob.size}`);
    }
    return new Uint8Array(await this.#blob.slice(Number(offset), Number(offset + size)).arrayBuffer());
  }
};

// node_modules/.pnpm/fzstd@0.1.1/node_modules/fzstd/esm/index.mjs
var ab = ArrayBuffer;
var u8 = Uint8Array;
var u16 = Uint16Array;
var i16 = Int16Array;
var i32 = Int32Array;
var slc = function(v, s, e) {
  if (u8.prototype.slice)
    return u8.prototype.slice.call(v, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  var n = new u8(e - s);
  n.set(v.subarray(s, e));
  return n;
};
var fill = function(v, n, s, e) {
  if (u8.prototype.fill)
    return u8.prototype.fill.call(v, n, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  for (; s < e; ++s)
    v[s] = n;
  return v;
};
var cpw = function(v, t, s, e) {
  if (u8.prototype.copyWithin)
    return u8.prototype.copyWithin.call(v, t, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  while (s < e) {
    v[t++] = v[s++];
  }
};
var ec = [
  "invalid zstd data",
  "window size too large (>2046MB)",
  "invalid block type",
  "FSE accuracy too high",
  "match distance too far back",
  "unexpected EOF"
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var rb = function(d, b, n) {
  var i = 0, o = 0;
  for (; i < n; ++i)
    o |= d[b++] << (i << 3);
  return o;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var rzfh = function(dat, w) {
  var n3 = dat[0] | dat[1] << 8 | dat[2] << 16;
  if (n3 == 3126568 && dat[3] == 253) {
    var flg = dat[4];
    var ss = flg >> 5 & 1, cc = flg >> 2 & 1, df = flg & 3, fcf = flg >> 6;
    if (flg & 8)
      err(0);
    var bt = 6 - ss;
    var db = df == 3 ? 4 : df;
    var di = rb(dat, bt, db);
    bt += db;
    var fsb = fcf ? 1 << fcf : ss;
    var fss = rb(dat, bt, fsb) + (fcf == 1 && 256);
    var ws = fss;
    if (!ss) {
      var wb = 1 << 10 + (dat[5] >> 3);
      ws = wb + (wb >> 3) * (dat[5] & 7);
    }
    if (ws > 2145386496)
      err(1);
    var buf = new u8((w == 1 ? fss || ws : w ? 0 : ws) + 12);
    buf[0] = 1, buf[4] = 4, buf[8] = 8;
    return {
      b: bt + fsb,
      y: 0,
      l: 0,
      d: di,
      w: w && w != 1 ? w : buf.subarray(12),
      e: ws,
      o: new i32(buf.buffer, 0, 3),
      u: fss,
      c: cc,
      m: Math.min(131072, ws)
    };
  } else if ((n3 >> 4 | dat[3] << 20) == 25481893) {
    return b4(dat, 4) + 8;
  }
  err(0);
};
var msb = function(val) {
  var bits = 0;
  for (; 1 << bits <= val; ++bits)
    ;
  return bits - 1;
};
var rfse = function(dat, bt, mal) {
  var tpos = (bt << 3) + 4;
  var al = (dat[bt] & 15) + 5;
  if (al > mal)
    err(3);
  var sz = 1 << al;
  var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
  var buf = new ab(512 + (sz << 2));
  var freq = new i16(buf, 0, 256);
  var dstate = new u16(buf, 0, 256);
  var nstate = new u16(buf, 512, sz);
  var bb1 = 512 + (sz << 1);
  var syms = new u8(buf, bb1, sz);
  var nbits = new u8(buf, bb1 + sz);
  while (sym < 255 && probs > 0) {
    var bits = msb(probs + 1);
    var cbt = tpos >> 3;
    var msk = (1 << bits + 1) - 1;
    var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (tpos & 7) & msk;
    var msk1fb = (1 << bits) - 1;
    var msv = msk - probs - 1;
    var sval = val & msk1fb;
    if (sval < msv)
      tpos += bits, val = sval;
    else {
      tpos += bits + 1;
      if (val > msk1fb)
        val -= msv;
    }
    freq[++sym] = --val;
    if (val == -1) {
      probs += val;
      syms[--ht] = sym;
    } else
      probs -= val;
    if (!val) {
      do {
        var rbt = tpos >> 3;
        re = (dat[rbt] | dat[rbt + 1] << 8) >> (tpos & 7) & 3;
        tpos += 2;
        sym += re;
      } while (re == 3);
    }
  }
  if (sym > 255 || probs)
    err(0);
  var sympos = 0;
  var sstep = (sz >> 1) + (sz >> 3) + 3;
  var smask = sz - 1;
  for (var s = 0; s <= sym; ++s) {
    var sf = freq[s];
    if (sf < 1) {
      dstate[s] = -sf;
      continue;
    }
    for (i = 0; i < sf; ++i) {
      syms[sympos] = s;
      do {
        sympos = sympos + sstep & smask;
      } while (sympos >= ht);
    }
  }
  if (sympos)
    err(0);
  for (i = 0; i < sz; ++i) {
    var ns = dstate[syms[i]]++;
    var nb = nbits[i] = al - msb(ns);
    nstate[i] = (ns << nb) - sz;
  }
  return [tpos + 7 >> 3, {
    b: al,
    s: syms,
    n: nbits,
    t: nstate
  }];
};
var rhu = function(dat, bt) {
  var i = 0, wc = -1;
  var buf = new u8(292), hb = dat[bt];
  var hw = buf.subarray(0, 256);
  var rc = buf.subarray(256, 268);
  var ri = new u16(buf.buffer, 268);
  if (hb < 128) {
    var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
    bt += hb;
    var epos = ebt << 3;
    var lb = dat[bt];
    if (!lb)
      err(0);
    var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
    var fpos = (++bt << 3) - 8 + msb(lb);
    for (; ; ) {
      fpos -= btr1;
      if (fpos < epos)
        break;
      var cbt = fpos >> 3;
      st1 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr1) - 1;
      hw[++wc] = fdt.s[st1];
      fpos -= btr2;
      if (fpos < epos)
        break;
      cbt = fpos >> 3;
      st2 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr2) - 1;
      hw[++wc] = fdt.s[st2];
      btr1 = fdt.n[st1];
      st1 = fdt.t[st1];
      btr2 = fdt.n[st2];
      st2 = fdt.t[st2];
    }
    if (++wc > 255)
      err(0);
  } else {
    wc = hb - 127;
    for (; i < wc; i += 2) {
      var byte = dat[++bt];
      hw[i] = byte >> 4;
      hw[i + 1] = byte & 15;
    }
    ++bt;
  }
  var wes = 0;
  for (i = 0; i < wc; ++i) {
    var wt = hw[i];
    if (wt > 11)
      err(0);
    wes += wt && 1 << wt - 1;
  }
  var mb = msb(wes) + 1;
  var ts = 1 << mb;
  var rem = ts - wes;
  if (rem & rem - 1)
    err(0);
  hw[wc++] = msb(rem) + 1;
  for (i = 0; i < wc; ++i) {
    var wt = hw[i];
    ++rc[hw[i] = wt && mb + 1 - wt];
  }
  var hbuf = new u8(ts << 1);
  var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
  ri[mb] = 0;
  for (i = mb; i > 0; --i) {
    var pv = ri[i];
    fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << mb - i));
  }
  if (ri[0] != ts)
    err(0);
  for (i = 0; i < wc; ++i) {
    var bits = hw[i];
    if (bits) {
      var code = ri[bits];
      fill(syms, i, code, ri[bits] = code + (1 << mb - bits));
    }
  }
  return [bt, {
    n: nb,
    b: mb,
    s: syms
  }];
};
var dllt = rfse(/* @__PURE__ */ new u8([
  81,
  16,
  99,
  140,
  49,
  198,
  24,
  99,
  12,
  33,
  196,
  24,
  99,
  102,
  102,
  134,
  70,
  146,
  4
]), 0, 6)[1];
var dmlt = rfse(/* @__PURE__ */ new u8([
  33,
  20,
  196,
  24,
  99,
  140,
  33,
  132,
  16,
  66,
  8,
  33,
  132,
  16,
  66,
  8,
  33,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  36,
  9
]), 0, 6)[1];
var doct = rfse(/* @__PURE__ */ new u8([
  32,
  132,
  16,
  66,
  102,
  70,
  68,
  68,
  68,
  68,
  36,
  73,
  2
]), 0, 5)[1];
var b2bl = function(b, s) {
  var len = b.length, bl = new i32(len);
  for (var i = 0; i < len; ++i) {
    bl[i] = s;
    s += 1 << b[i];
  }
  return bl;
};
var llb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
  0,
  0,
  0,
  0,
  16843009,
  50528770,
  134678020,
  202050057,
  269422093
])).buffer, 0, 36);
var llbl = /* @__PURE__ */ b2bl(llb, 0);
var mlb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  16843009,
  50528770,
  117769220,
  185207048,
  252579084,
  16
])).buffer, 0, 53);
var mlbl = /* @__PURE__ */ b2bl(mlb, 3);
var dhu = function(dat, out, hu) {
  var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
  if (!lb)
    err(0);
  var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
  for (; pos > eb && i < ss; ) {
    var cbt = pos >> 3;
    var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (pos & 7);
    st = (st << btr | val) & msk;
    out[++i] = hu.s[st];
    pos -= btr = hu.n[st];
  }
  if (pos != eb || i + 1 != ss)
    err(0);
};
var dhu4 = function(dat, out, hu) {
  var bt = 6;
  var ss = out.length, sz1 = ss + 3 >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
  dhu(dat.subarray(bt, bt += dat[0] | dat[1] << 8), out.subarray(0, sz1), hu);
  dhu(dat.subarray(bt, bt += dat[2] | dat[3] << 8), out.subarray(sz1, sz2), hu);
  dhu(dat.subarray(bt, bt += dat[4] | dat[5] << 8), out.subarray(sz2, sz3), hu);
  dhu(dat.subarray(bt), out.subarray(sz3), hu);
};
var rzb = function(dat, st, out) {
  var _a;
  var bt = st.b;
  var b0 = dat[bt], btype = b0 >> 1 & 3;
  st.l = b0 & 1;
  var sz = b0 >> 3 | dat[bt + 1] << 5 | dat[bt + 2] << 13;
  var ebt = (bt += 3) + sz;
  if (btype == 1) {
    if (bt >= dat.length)
      return;
    st.b = bt + 1;
    if (out) {
      fill(out, dat[bt], st.y, st.y += sz);
      return out;
    }
    return fill(new u8(sz), dat[bt]);
  }
  if (ebt > dat.length)
    return;
  if (btype == 0) {
    st.b = ebt;
    if (out) {
      out.set(dat.subarray(bt, ebt), st.y);
      st.y += sz;
      return out;
    }
    return slc(dat, bt, ebt);
  }
  if (btype == 2) {
    var b3 = dat[bt], lbt = b3 & 3, sf = b3 >> 2 & 3;
    var lss = b3 >> 4, lcs = 0, s4 = 0;
    if (lbt < 2) {
      if (sf & 1)
        lss |= dat[++bt] << 4 | (sf & 2 && dat[++bt] << 12);
      else
        lss = b3 >> 3;
    } else {
      s4 = sf;
      if (sf < 2)
        lss |= (dat[++bt] & 63) << 4, lcs = dat[bt] >> 6 | dat[++bt] << 2;
      else if (sf == 2)
        lss |= dat[++bt] << 4 | (dat[++bt] & 3) << 12, lcs = dat[bt] >> 2 | dat[++bt] << 6;
      else
        lss |= dat[++bt] << 4 | (dat[++bt] & 63) << 12, lcs = dat[bt] >> 6 | dat[++bt] << 2 | dat[++bt] << 10;
    }
    ++bt;
    var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
    var spl = buf.length - lss;
    if (lbt == 0)
      buf.set(dat.subarray(bt, bt += lss), spl);
    else if (lbt == 1)
      fill(buf, dat[bt++], spl);
    else {
      var hu = st.h;
      if (lbt == 2) {
        var hud = rhu(dat, bt);
        lcs += bt - (bt = hud[0]);
        st.h = hu = hud[1];
      } else if (!hu)
        err(0);
      (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
    }
    var ns = dat[bt++];
    if (ns) {
      if (ns == 255)
        ns = (dat[bt++] | dat[bt++] << 8) + 32512;
      else if (ns > 127)
        ns = ns - 128 << 8 | dat[bt++];
      var scm = dat[bt++];
      if (scm & 3)
        err(0);
      var dts = [dmlt, doct, dllt];
      for (var i = 2; i > -1; --i) {
        var md = scm >> (i << 1) + 2 & 3;
        if (md == 1) {
          var rbuf = new u8([0, 0, dat[bt++]]);
          dts[i] = {
            s: rbuf.subarray(2, 3),
            n: rbuf.subarray(0, 1),
            t: new u16(rbuf.buffer, 0, 1),
            b: 0
          };
        } else if (md == 2) {
          _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
        } else if (md == 3) {
          if (!st.t)
            err(0);
          dts[i] = st.t[i];
        }
      }
      var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
      var lb = dat[ebt - 1];
      if (!lb)
        err(0);
      var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
      var lst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << llt.b) - 1;
      cbt = (spos -= oct.b) >> 3;
      var ost = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << oct.b) - 1;
      cbt = (spos -= mlt.b) >> 3;
      var mst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mlt.b) - 1;
      for (++ns; --ns; ) {
        var llc = llt.s[lst];
        var lbtr = llt.n[lst];
        var mlc = mlt.s[mst];
        var mbtr = mlt.n[mst];
        var ofc = oct.s[ost];
        var obtr = oct.n[ost];
        cbt = (spos -= ofc) >> 3;
        var ofp = 1 << ofc;
        var off = ofp + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16 | dat[cbt + 3] << 24) >>> (spos & 7) & ofp - 1);
        cbt = (spos -= mlb[mlc]) >> 3;
        var ml = mlbl[mlc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << mlb[mlc]) - 1);
        cbt = (spos -= llb[llc]) >> 3;
        var ll = llbl[llc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << llb[llc]) - 1);
        cbt = (spos -= lbtr) >> 3;
        lst = llt.t[lst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << lbtr) - 1);
        cbt = (spos -= mbtr) >> 3;
        mst = mlt.t[mst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mbtr) - 1);
        cbt = (spos -= obtr) >> 3;
        ost = oct.t[ost] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << obtr) - 1);
        if (off > 3) {
          st.o[2] = st.o[1];
          st.o[1] = st.o[0];
          st.o[0] = off -= 3;
        } else {
          var idx = off - (ll != 0);
          if (idx) {
            off = idx == 3 ? st.o[0] - 1 : st.o[idx];
            if (idx > 1)
              st.o[2] = st.o[1];
            st.o[1] = st.o[0];
            st.o[0] = off;
          } else
            off = st.o[0];
        }
        for (var i = 0; i < ll; ++i) {
          buf[oubt + i] = buf[spl + i];
        }
        oubt += ll, spl += ll;
        var stin = oubt - off;
        if (stin < 0) {
          var len = -stin;
          var bs = st.e + stin;
          if (len > ml)
            len = ml;
          for (var i = 0; i < len; ++i) {
            buf[oubt + i] = st.w[bs + i];
          }
          oubt += len, ml -= len, stin = 0;
        }
        for (var i = 0; i < ml; ++i) {
          buf[oubt + i] = buf[stin + i];
        }
        oubt += ml;
      }
      if (oubt != spl) {
        while (spl < buf.length) {
          buf[oubt++] = buf[spl++];
        }
      } else
        oubt = buf.length;
      if (out)
        st.y += oubt;
      else
        buf = slc(buf, 0, oubt);
    } else if (out) {
      st.y += lss;
      if (spl) {
        for (var i = 0; i < lss; ++i) {
          buf[i] = buf[spl + i];
        }
      }
    } else if (spl)
      buf = slc(buf, spl);
    st.b = ebt;
    return buf;
  }
  err(2);
};
var cct = function(bufs, ol) {
  if (bufs.length == 1)
    return bufs[0];
  var buf = new u8(ol);
  for (var i = 0, b = 0; i < bufs.length; ++i) {
    var chk = bufs[i];
    buf.set(chk, b);
    b += chk.length;
  }
  return buf;
};
function decompress(dat, buf) {
  var bufs = [], nb = +!buf;
  var bt = 0, ol = 0;
  for (; dat.length; ) {
    var st = rzfh(dat, nb || buf);
    if (typeof st == "object") {
      if (nb) {
        buf = null;
        if (st.w.length == st.u) {
          bufs.push(buf = st.w);
          ol += st.u;
        }
      } else {
        bufs.push(buf);
        st.e = 0;
      }
      for (; !st.l; ) {
        var blk = rzb(dat, st, buf);
        if (!blk)
          err(5);
        if (buf)
          st.e = st.y;
        else {
          bufs.push(blk);
          ol += blk.length;
          cpw(st.w, 0, blk.length);
          st.w.set(blk, st.w.length - blk.length);
        }
      }
      bt = st.b + st.c * 4;
    } else
      bt = st;
    dat = dat.subarray(bt);
  }
  return cct(bufs, ol);
}

// src/parsers/cdr.ts
var import_rosmsg2 = __toESM(require_dist(), 1);
var import_rosmsg2_serialization = __toESM(require_dist3(), 1);

// src/parsers/typeRegistry.ts
var import_rosmsg = __toESM(require_dist(), 1);

// src/parsers/rosbag1.ts
var import_rosmsg3 = __toESM(require_dist(), 1);
var import_rosmsg_serialization = __toESM(require_cjs(), 1);

// src/parsers/source.ts
function sourceKey(source) {
  if (source.kind === "multi") return `multi:${source.parts.map(sourceKey).sort().join("|")}`;
  if (source.kind === "file") return `file:${source.file.name}:${source.file.size}`;
  return `url:${source.url}`;
}
function sourceDisplayName(source) {
  if (source.kind === "multi") return source.displayName;
  return source.kind === "file" ? source.file.name : source.displayName;
}
function sourceSize(source) {
  if (source.kind === "multi") return source.parts.reduce((n, p) => n + sourceSize(p), 0);
  return source.kind === "file" ? source.file.size : source.contentLength;
}
async function sourceReadAll(source) {
  if (source.kind === "file") {
    const ab2 = await source.file.arrayBuffer();
    return new Uint8Array(ab2);
  }
  const res = await fetch(source.url, { mode: "cors" });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${source.url}": HTTP ${res.status} ${res.statusText}. Verify the URL is reachable and the server allows cross-origin requests.`
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
async function sourceReadSlice(source, start, end) {
  if (source.kind === "file") {
    const ab2 = await source.file.slice(start, end).arrayBuffer();
    return new Uint8Array(ab2);
  }
  const res = await fetch(source.url, {
    mode: "cors",
    headers: { Range: `bytes=${start}-${end - 1}` }
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(
      `Failed to fetch range from "${source.url}": HTTP ${res.status}. The server may not support Range requests.`
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.subarray(0, end - start);
}
var HTTP_RANGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
var HttpRangeCache = class {
  entries = /* @__PURE__ */ new Map();
  totalBytes = 0;
  maxBytes;
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return void 0;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  set(key, data) {
    if (this.entries.has(key)) return;
    while (this.totalBytes + data.byteLength > this.maxBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value;
      this.totalBytes -= this.entries.get(oldest).byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, data);
    this.totalBytes += data.byteLength;
  }
};
var HttpReadable = class {
  url;
  sizeBytes;
  rangeCache = new HttpRangeCache(HTTP_RANGE_CACHE_MAX_BYTES);
  constructor(url, sizeBytes) {
    this.url = url;
    this.sizeBytes = sizeBytes;
  }
  async size() {
    return this.sizeBytes;
  }
  async read(offset, size) {
    const key = `${offset}:${size}`;
    const hit = this.rangeCache.get(key);
    if (hit) return hit;
    const { data, complete } = await rangeFetch(this.url, Number(offset), Number(size));
    if (complete) this.rangeCache.set(key, data);
    return data;
  }
};
var HttpFilelike = class {
  url;
  contentLength;
  rangeCache = new HttpRangeCache(HTTP_RANGE_CACHE_MAX_BYTES);
  constructor(url, contentLength) {
    this.url = url;
    this.contentLength = contentLength;
  }
  size() {
    return this.contentLength;
  }
  async read(offset, length) {
    const key = `${offset}:${length}`;
    const hit = this.rangeCache.get(key);
    if (hit) return hit;
    const { data, complete } = await rangeFetch(this.url, offset, length);
    if (complete) this.rangeCache.set(key, data);
    return data;
  }
};
async function rangeFetch(url, offset, length) {
  const end = offset + length - 1;
  let res;
  try {
    res = await fetch(url, {
      mode: "cors",
      headers: { Range: `bytes=${offset}-${end}` }
    });
  } catch (err2) {
    throw new Error(
      `Could not fetch from "${url}": ${err2 instanceof Error ? err2.message : String(err2)}. This often means the remote server does not allow cross-origin requests. Try a CORS-enabled mirror, or download the file and drag it in.`,
      { cause: err2 }
    );
  }
  if (res.status === 416) {
    throw new Error(
      `Server returned 416 Range Not Satisfiable for "${url}" (bytes=${offset}-${end}). The bag may be truncated or the wrong content length was advertised.`
    );
  }
  if (res.status !== 206) {
    if (res.status === 200) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length >= offset + length) {
        return { data: buf.subarray(offset, offset + length), complete: true };
      }
      return { data: buf.subarray(offset), complete: false };
    }
    throw new Error(
      `Server returned ${res.status} for range request to "${url}". Expected 206 Partial Content. The host may not support HTTP Range.`
    );
  }
  const data = new Uint8Array(await res.arrayBuffer());
  return { data, complete: data.byteLength === length };
}

// src/parsers/mcap.ts
function readableFor(source) {
  if (source.kind === "file") return new BlobReadable(source.file);
  return new HttpReadable(source.url, BigInt(source.contentLength));
}
var CHUNK_CACHE_MAX_BYTES = 256 * 1024 * 1024;
var ChunkCache = class {
  entries = /* @__PURE__ */ new Map();
  totalBytes = 0;
  tickCounter = 0;
  maxBytes;
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  get(key) {
    const e = this.entries.get(key);
    if (!e) return void 0;
    e.ts = ++this.tickCounter;
    return e.data;
  }
  set(key, data) {
    if (this.entries.has(key)) return;
    while (this.totalBytes + data.byteLength > this.maxBytes && this.entries.size > 0) {
      this.evictOldest();
    }
    this.entries.set(key, { data, ts: ++this.tickCounter });
    this.totalBytes += data.byteLength;
  }
  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }
  evictOldest() {
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [k, v] of this.entries) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey === null) return;
    const evicted = this.entries.get(oldestKey);
    this.totalBytes -= evicted.data.byteLength;
    this.entries.delete(oldestKey);
  }
};
function fingerprintBuffer(buf) {
  const len = buf.length;
  if (len === 0) return "e";
  const FNV_PRIME = 16777619;
  let h = 2166136261;
  const headEnd = Math.min(64, len);
  for (let i = 0; i < headEnd; i++) h = Math.imul(h ^ buf[i], FNV_PRIME);
  if (len > 256) {
    const mid = (len >> 1) - 32;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ buf[mid + i], FNV_PRIME);
  }
  if (len > 128) {
    const tail = len - 64;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ buf[tail + i], FNV_PRIME);
  }
  return `${len}|${(h >>> 0).toString(36)}`;
}
function makeDecompressHandlers(chunkCache) {
  return {
    zstd: (buffer, decompressedSize) => {
      const key = fingerprintBuffer(buffer);
      const hit = chunkCache.get(key);
      if (hit) return hit;
      const out = decompress(
        // fzstd accepts an optional pre-sized output buffer; we pass MCAP's
        // declared decompressedSize to avoid resize overhead. The hint is
        // not validated against the real output: a too-small or zero hint
        // throws 'invalid zstd data' only at read time, and a too-large
        // hint yields a declared-length buffer with a zero tail. See
        // tests/parsers/robustness.test.ts for pinned behavior.
        buffer,
        new Uint8Array(Number(decompressedSize))
      );
      chunkCache.set(key, out);
      return out;
    }
  };
}
var cached = null;
function decodeSchemaText(data) {
  return new TextDecoder().decode(data);
}
var UNINDEXED_SCAN_WINDOW_BYTES = 8 * 1024 * 1024;
var MCAP_RECORD_HEADER_BYTES = 9;
var MCAP_MESSAGE_FIXED_BYTES = 22;
var MCAP_MAGIC_BYTES = new Uint8Array([137, 77, 67, 65, 80, 48, 13, 10]);
var ReadAheadWindow = class {
  start = 0;
  data = new Uint8Array(0);
  readable;
  fileSize;
  constructor(readable, fileSize) {
    this.readable = readable;
    this.fileSize = fileSize;
  }
  async read(offset, length) {
    if (length <= 0 || offset >= this.fileSize) return new Uint8Array(0);
    if (offset >= this.start && offset + length <= this.start + this.data.byteLength) {
      const local = offset - this.start;
      return this.data.subarray(local, local + length);
    }
    const available = this.fileSize - offset;
    const fetchLength = Math.max(0, Math.min(
      available,
      Math.max(length, UNINDEXED_SCAN_WINDOW_BYTES)
    ));
    this.start = offset;
    this.data = await this.readable.read(BigInt(offset), BigInt(fetchLength));
    if (this.data.byteLength < length) {
      throw new Error(
        `MCAP range read returned ${this.data.byteLength} bytes, expected ${length}`
      );
    }
    return this.data.subarray(0, length);
  }
};
function pushUnindexedRef(refsByChannel, channelId, ref) {
  const refs = refsByChannel.get(channelId);
  if (refs) refs.push(ref);
  else refsByChannel.set(channelId, [ref]);
}
function updateUnindexedTime(current, logTime) {
  if (current.total === 0 || logTime < current.startTime) current.startTime = logTime;
  if (current.total === 0 || logTime > current.endTime) current.endTime = logTime;
  current.total++;
}
async function scanUnindexedMcap(readable, size, decompressHandlers, channelById, schemaById) {
  const window2 = new ReadAheadWindow(readable, size);
  const magic = await window2.read(0, MCAP_MAGIC_BYTES.byteLength);
  if (!MCAP_MAGIC_BYTES.every((value, index) => magic[index] === value)) {
    throw new Error("The file does not begin with valid MCAP magic.");
  }
  const streamReader = new McapStreamReader({
    includeChunks: true,
    decompressHandlers
  });
  streamReader.append(magic);
  while (streamReader.nextRecord()) {
  }
  let header = null;
  const channelRecords = /* @__PURE__ */ new Map();
  const refsByChannel = /* @__PURE__ */ new Map();
  const messageCounts = /* @__PURE__ */ new Map();
  const time = { startTime: 0n, endTime: 0n, total: 0 };
  let offset = MCAP_MAGIC_BYTES.byteLength;
  while (offset + MCAP_RECORD_HEADER_BYTES <= size) {
    const fixedLength = Math.min(
      MCAP_RECORD_HEADER_BYTES + MCAP_MESSAGE_FIXED_BYTES,
      size - offset
    );
    const fixed = await window2.read(offset, fixedLength);
    const opcode = fixed[0];
    const bodyLength = readU64LENum(fixed, 1);
    const recordLength = MCAP_RECORD_HEADER_BYTES + bodyLength;
    if (!Number.isSafeInteger(recordLength) || bodyLength < 0) {
      throw new Error(`MCAP record at byte ${offset} has an invalid length.`);
    }
    if (offset + recordLength > size) break;
    if (opcode === 5) {
      if (bodyLength < MCAP_MESSAGE_FIXED_BYTES || fixed.byteLength < 31) {
        throw new Error(`MCAP message at byte ${offset} is too short.`);
      }
      const channelId = readU16LE(fixed, 9);
      const logTime = readU64LEBig(fixed, 15);
      const ref = {
        kind: "message",
        recordOffset: offset,
        recordLength,
        dataOffset: offset + MCAP_RECORD_HEADER_BYTES + MCAP_MESSAGE_FIXED_BYTES,
        dataLength: bodyLength - MCAP_MESSAGE_FIXED_BYTES,
        channelId,
        logTime
      };
      pushUnindexedRef(refsByChannel, channelId, ref);
      messageCounts.set(channelId, (messageCounts.get(channelId) ?? 0) + 1);
      updateUnindexedTime(time, logTime);
      offset += recordLength;
      continue;
    }
    const bytes = await window2.read(offset, recordLength);
    streamReader.append(bytes);
    let chunkRef = null;
    for (let record; record = streamReader.nextRecord(); ) {
      if (record.type === "Header") {
        header = { profile: record.profile, library: record.library };
      } else if (record.type === "Schema") {
        schemaById.set(record.id, {
          name: record.name,
          encoding: record.encoding,
          data: record.data.slice()
        });
      } else if (record.type === "Channel") {
        channelById.set(record.id, {
          topic: record.topic,
          schemaId: record.schemaId,
          messageEncoding: record.messageEncoding
        });
        channelRecords.set(record.id, {
          id: record.id,
          schemaId: record.schemaId,
          topic: record.topic,
          messageEncoding: record.messageEncoding,
          metadata: new Map(record.metadata)
        });
      } else if (record.type === "Chunk") {
        chunkRef = {
          kind: "chunk",
          recordOffset: offset,
          recordLength,
          startTime: record.messageStartTime,
          endTime: record.messageEndTime,
          channelIds: /* @__PURE__ */ new Set()
        };
      } else if (record.type === "Message") {
        if (!chunkRef) continue;
        chunkRef.channelIds.add(record.channelId);
        messageCounts.set(
          record.channelId,
          (messageCounts.get(record.channelId) ?? 0) + 1
        );
        updateUnindexedTime(time, record.logTime);
      }
    }
    if (chunkRef) {
      for (const channelId of chunkRef.channelIds) {
        pushUnindexedRef(refsByChannel, channelId, chunkRef);
      }
    }
    offset += recordLength;
  }
  const builder = new McapRecordBuilder();
  builder.writeMagic();
  builder.writeHeader(header ?? { profile: "", library: "BAGEL range reader" });
  for (const [id, schema] of schemaById) {
    builder.writeSchema({ id, ...schema });
  }
  for (const channel of channelRecords.values()) {
    builder.writeChannel(channel);
  }
  return {
    refsByChannel,
    messageCounts,
    startTime: time.startTime,
    endTime: time.endTime,
    totalMessageCount: time.total,
    preamble: builder.buffer.slice(0, builder.length)
  };
}
function channelIdsForTopic(meta, topicName) {
  const ids = /* @__PURE__ */ new Set();
  for (const [id, channel] of meta.channelById) {
    if (channel.topic === topicName) ids.add(id);
  }
  return ids;
}
async function readUnindexedRef(source, meta, ref, channelIds) {
  const readable = readableFor(source);
  if (ref.kind === "message") {
    if (!channelIds.has(ref.channelId)) return [];
    const data = await readable.read(BigInt(ref.dataOffset), BigInt(ref.dataLength));
    return [{ topicName: "", timestamp: ref.logTime, data }];
  }
  const bytes = await readable.read(BigInt(ref.recordOffset), BigInt(ref.recordLength));
  const reader = new McapStreamReader({
    decompressHandlers: meta.decompressHandlers
  });
  reader.append(meta.unindexed.preamble);
  while (reader.nextRecord()) {
  }
  reader.append(bytes);
  const out = [];
  for (let record; record = reader.nextRecord(); ) {
    if (record.type !== "Message" || !channelIds.has(record.channelId)) continue;
    out.push({
      topicName: "",
      timestamp: record.logTime,
      data: record.data instanceof Uint8Array ? record.data.slice() : new Uint8Array(record.data)
    });
  }
  return out;
}
async function readRawMessagesUnindexed(source, meta, topicName, limit, startNs, endNs) {
  const channelIds = channelIdsForTopic(meta, topicName);
  const refs = /* @__PURE__ */ new Map();
  for (const channelId of channelIds) {
    for (const ref of meta.unindexed?.refsByChannel.get(channelId) ?? []) {
      if (ref.kind === "message") {
        if (startNs !== void 0 && ref.logTime < startNs) continue;
        if (endNs !== void 0 && ref.logTime > endNs) continue;
      } else {
        if (startNs !== void 0 && ref.endTime < startNs) continue;
        if (endNs !== void 0 && ref.startTime > endNs) continue;
      }
      refs.set(ref.recordOffset, ref);
    }
  }
  const ordered = Array.from(refs.values()).sort((a, b) => a.recordOffset - b.recordOffset);
  const readable = readableFor(source);
  const out = [];
  const maxBatchBytes = 1024 * 1024;
  const maxGapBytes = 64 * 1024;
  for (let index = 0; index < ordered.length; ) {
    const ref = ordered[index];
    if (ref.kind === "chunk") {
      const messages = await readUnindexedRef(source, meta, ref, channelIds);
      for (const message of messages) {
        if (startNs !== void 0 && message.timestamp < startNs) continue;
        if (endNs !== void 0 && message.timestamp > endNs) continue;
        message.topicName = topicName;
        out.push(message);
        if (limit && out.length >= limit) return out;
      }
      index++;
      continue;
    }
    const batchRefs = [ref];
    const batchStart = ref.dataOffset;
    let batchEnd = ref.dataOffset + ref.dataLength;
    let nextIndex = index + 1;
    while (nextIndex < ordered.length) {
      const next = ordered[nextIndex];
      if (next.kind !== "message") break;
      const nextEnd = next.dataOffset + next.dataLength;
      if (next.dataOffset - batchEnd > maxGapBytes) break;
      if (nextEnd - batchStart > maxBatchBytes) break;
      batchRefs.push(next);
      batchEnd = nextEnd;
      nextIndex++;
      if (limit && out.length + batchRefs.length >= limit) break;
    }
    const batch = await readable.read(
      BigInt(batchStart),
      BigInt(batchEnd - batchStart)
    );
    for (const messageRef of batchRefs) {
      const localStart = messageRef.dataOffset - batchStart;
      out.push({
        topicName,
        timestamp: messageRef.logTime,
        data: batch.slice(localStart, localStart + messageRef.dataLength)
      });
      if (limit && out.length >= limit) return out;
    }
    index = nextIndex;
  }
  return out;
}
async function loadMcap(source) {
  const key = sourceKey(source);
  if (cached && cached.sourceKey === key) {
    return cached;
  }
  const chunkCache = new ChunkCache(CHUNK_CACHE_MAX_BYTES);
  const decompressHandlers = makeDecompressHandlers(chunkCache);
  const messageCache = /* @__PURE__ */ new Map();
  const videoIndex = /* @__PURE__ */ new Map();
  const size = sourceSize(source);
  const displayName = sourceDisplayName(source);
  const readable = readableFor(source);
  let reader = null;
  const buffer = null;
  let unindexed = null;
  const channelById = /* @__PURE__ */ new Map();
  const schemaById = /* @__PURE__ */ new Map();
  const topicMeta = /* @__PURE__ */ new Map();
  let indexedError = null;
  try {
    reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });
    for (const schema of reader.schemasById.values()) {
      schemaById.set(schema.id, {
        name: schema.name,
        encoding: schema.encoding,
        data: schema.data
      });
    }
    for (const channel of reader.channelsById.values()) {
      channelById.set(channel.id, {
        topic: channel.topic,
        schemaId: channel.schemaId,
        messageEncoding: channel.messageEncoding
      });
      const schema = schemaById.get(channel.schemaId);
      topicMeta.set(channel.topic, {
        schemaName: schema?.name ?? "unknown",
        schemaText: schema ? decodeSchemaText(schema.data) : null,
        messageEncoding: channel.messageEncoding
      });
    }
  } catch (err2) {
    indexedError = err2;
  }
  if (!reader) {
    try {
      unindexed = await scanUnindexedMcap(
        readable,
        size,
        decompressHandlers,
        channelById,
        schemaById
      );
    } catch (scanError) {
      const indexedDetail = indexedError instanceof Error ? indexedError.message : String(indexedError);
      const scanDetail = scanError instanceof Error ? scanError.message : String(scanError);
      throw new Error(
        `Failed to load "${displayName}": the MCAP index could not be read (${indexedDetail}), and the range-based recovery scan also failed (${scanDetail}). The recording may be truncated inside a record.`,
        { cause: scanError }
      );
    }
  }
  for (const [, ch] of channelById) {
    const schema = schemaById.get(ch.schemaId);
    topicMeta.set(ch.topic, {
      schemaName: schema?.name ?? "unknown",
      schemaText: schema ? decodeSchemaText(schema.data) : null,
      messageEncoding: ch.messageEncoding
    });
  }
  cached = {
    sourceKey: key,
    displayName,
    size,
    reader,
    buffer,
    unindexed,
    channelById,
    schemaById,
    topicMeta,
    decompressHandlers,
    chunkCache,
    messageCache,
    videoIndex
  };
  return cached;
}
async function parseMcap(source) {
  const meta = await loadMcap(source);
  if (meta.reader) {
    return extractSummaryFromIndexed(meta);
  }
  if (meta.buffer) {
    return extractSummaryFromStream(meta);
  }
  if (meta.unindexed) {
    return extractSummaryFromUnindexed(meta);
  }
  throw new Error(
    `"${meta.displayName}" does not appear to be a valid MCAP file. The file header does not match the MCAP format. Please ensure you are uploading a .mcap bag file recorded by ROS2.`
  );
}
function extractSummaryFromIndexed(meta) {
  const reader = meta.reader;
  const messageCounts = /* @__PURE__ */ new Map();
  if (reader.statistics) {
    for (const [channelId, count] of reader.statistics.channelMessageCounts) {
      messageCounts.set(channelId, Number(count));
    }
  }
  const topics = [];
  for (const [channelId, ch] of meta.channelById) {
    const schema = meta.schemaById.get(ch.schemaId);
    topics.push({
      name: ch.topic,
      type: schema?.name ?? "unknown",
      messageCount: messageCounts.get(channelId) ?? 0,
      serializationFormat: ch.messageEncoding || "cdr"
    });
  }
  const startTime = reader.statistics?.messageStartTime ?? 0n;
  const endTime = reader.statistics?.messageEndTime ?? 0n;
  const duration = Number(endTime - startTime) / 1e9;
  const totalMessageCount = reader.statistics ? Number(reader.statistics.messageCount) : topics.reduce((sum, t) => sum + t.messageCount, 0);
  if (duration > 0) {
    for (const topic of topics) {
      topic.frequency = Math.round(topic.messageCount / duration * 10) / 10;
    }
  }
  return {
    format: "mcap",
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name))
  };
}
function extractSummaryFromUnindexed(meta) {
  const index = meta.unindexed;
  const duration = Number(index.endTime - index.startTime) / 1e9;
  const topics = [];
  for (const [channelId, channel] of meta.channelById) {
    const schema = meta.schemaById.get(channel.schemaId);
    const messageCount = index.messageCounts.get(channelId) ?? 0;
    topics.push({
      name: channel.topic,
      type: schema?.name ?? "unknown",
      messageCount,
      serializationFormat: channel.messageEncoding || "cdr",
      frequency: duration > 0 ? Math.round(messageCount / duration * 10) / 10 : void 0
    });
  }
  return {
    format: "mcap",
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime: index.startTime,
    endTime: index.endTime,
    duration,
    totalMessageCount: index.totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name))
  };
}
function extractSummaryFromStream(meta) {
  const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
  reader.append(meta.buffer);
  const channelMessageCounts = /* @__PURE__ */ new Map();
  let minTimestamp = BigInt(Number.MAX_SAFE_INTEGER) * 1000000000n;
  let maxTimestamp = 0n;
  let totalMessages = 0;
  for (let record; record = reader.nextRecord(); ) {
    if (record.type === "Message") {
      totalMessages++;
      const count = channelMessageCounts.get(record.channelId) ?? 0;
      channelMessageCounts.set(record.channelId, count + 1);
      if (record.logTime < minTimestamp) minTimestamp = record.logTime;
      if (record.logTime > maxTimestamp) maxTimestamp = record.logTime;
    }
  }
  const duration = Number(maxTimestamp - minTimestamp) / 1e9;
  const topics = [];
  for (const [channelId, ch] of meta.channelById) {
    const schema = meta.schemaById.get(ch.schemaId);
    const count = channelMessageCounts.get(channelId) ?? 0;
    topics.push({
      name: ch.topic,
      type: schema?.name ?? "unknown",
      messageCount: count,
      serializationFormat: ch.messageEncoding || "cdr",
      frequency: duration > 0 ? Math.round(count / duration * 10) / 10 : void 0
    });
  }
  return {
    format: "mcap",
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime: minTimestamp,
    endTime: maxTimestamp,
    duration,
    totalMessageCount: totalMessages,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name))
  };
}
function readU16LE(b, o) {
  return b[o] | b[o + 1] << 8;
}
function readU32LE(b, o) {
  return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
}
function readU64LENum(b, o) {
  return readU32LE(b, o + 4) * 4294967296 + readU32LE(b, o);
}
function readU64LEBig(b, o) {
  return BigInt(readU32LE(b, o + 4)) << 32n | BigInt(readU32LE(b, o));
}
var MCAP_MAX_SAMPLES_PER_TOPIC = 5e4;
async function readAllMessageStatsMcap(source) {
  const meta = await loadMcap(source);
  if (meta.reader && meta.reader.chunkIndexes.length > 0) {
    return readStatsFromMcapIndexes(source, meta);
  }
  const rawTimes = /* @__PURE__ */ new Map();
  const rawSizes = /* @__PURE__ */ new Map();
  if (meta.buffer) {
    const streamReader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    streamReader.append(meta.buffer);
    for (let record; record = streamReader.nextRecord(); ) {
      if (record.type !== "Message") continue;
      const ch = meta.channelById.get(record.channelId);
      if (!ch) continue;
      const { topic } = ch;
      let t = rawTimes.get(topic);
      if (!t) {
        t = [];
        rawTimes.set(topic, t);
      }
      if (t.length < MCAP_MAX_SAMPLES_PER_TOPIC) t.push(record.logTime);
      let s = rawSizes.get(topic);
      if (!s) {
        s = [];
        rawSizes.set(topic, s);
      }
      if (s.length < MCAP_MAX_SAMPLES_PER_TOPIC) s.push(record.data.byteLength);
    }
  }
  if (meta.unindexed) {
    for (const [channelId, channel] of meta.channelById) {
      const refs = meta.unindexed.refsByChannel.get(channelId) ?? [];
      const hasChunks = refs.some((ref) => ref.kind === "chunk");
      if (hasChunks) {
        const raws = await readRawMessagesUnindexed(
          source,
          meta,
          channel.topic,
          MCAP_MAX_SAMPLES_PER_TOPIC
        );
        rawTimes.set(channel.topic, raws.map((raw) => raw.timestamp));
        rawSizes.set(channel.topic, raws.map((raw) => raw.data.byteLength));
        continue;
      }
      let times = rawTimes.get(channel.topic);
      if (!times) {
        times = [];
        rawTimes.set(channel.topic, times);
      }
      let sizes = rawSizes.get(channel.topic);
      if (!sizes) {
        sizes = [];
        rawSizes.set(channel.topic, sizes);
      }
      for (const ref of refs) {
        if (ref.kind !== "message") continue;
        if (times.length < MCAP_MAX_SAMPLES_PER_TOPIC) times.push(ref.logTime);
        if (sizes.length < MCAP_MAX_SAMPLES_PER_TOPIC) sizes.push(ref.dataLength);
      }
    }
  }
  let startNs = 0n;
  for (const times of rawTimes.values()) {
    for (const t of times) if (startNs === 0n || t < startNs) startNs = t;
  }
  const result = {};
  for (const [topic, times] of rawTimes) {
    const sizes = rawSizes.get(topic);
    const relTimes = new Float64Array(times.length);
    for (let i = 0; i < times.length; i++) relTimes[i] = Number(times[i] - startNs);
    result[topic] = { times: relTimes, sizes: new Uint32Array(sizes) };
  }
  return result;
}
async function readStatsFromMcapIndexes(source, meta) {
  const reader = meta.reader;
  const startNs = reader.statistics?.messageStartTime ?? 0n;
  const readable = readableFor(source);
  const rawTimes = /* @__PURE__ */ new Map();
  const topicTotalBytes = /* @__PURE__ */ new Map();
  const topicTotalCount = /* @__PURE__ */ new Map();
  for (const chunkIndex of reader.chunkIndexes) {
    if (chunkIndex.messageIndexOffsets.size === 0 || chunkIndex.messageIndexLength === 0n) continue;
    let firstOffset = 0n;
    let first = true;
    for (const off of chunkIndex.messageIndexOffsets.values()) {
      if (first || off < firstOffset) {
        firstOffset = off;
        first = false;
      }
    }
    const buf = await readable.read(firstOffset, chunkIndex.messageIndexLength);
    let pos = 0;
    while (pos + 9 <= buf.length) {
      if (buf[pos] !== 7) break;
      const bodyLen = readU64LENum(buf, pos + 1);
      if (pos + 9 + bodyLen > buf.length) break;
      const channelId = readU16LE(buf, pos + 9);
      const recordsByteLen = readU32LE(buf, pos + 11);
      const numRecords = Math.floor(recordsByteLen / 16);
      const ch = meta.channelById.get(channelId);
      if (ch) {
        const { topic } = ch;
        let times = rawTimes.get(topic);
        if (!times) {
          times = [];
          rawTimes.set(topic, times);
        }
        const existing = times.length;
        const capacity = MCAP_MAX_SAMPLES_PER_TOPIC - existing;
        const step = capacity > 0 ? Math.max(1, Math.floor(numRecords / Math.min(numRecords, capacity))) : 0;
        if (step > 0) {
          for (let i = 0; i < numRecords; i += step) {
            const o = pos + 15 + i * 16;
            if (o + 8 > buf.length) break;
            times.push(readU64LEBig(buf, o));
          }
        }
        const channelCount = chunkIndex.messageIndexOffsets.size;
        topicTotalBytes.set(
          topic,
          (topicTotalBytes.get(topic) ?? 0) + Number(chunkIndex.uncompressedSize) / channelCount
        );
        topicTotalCount.set(topic, (topicTotalCount.get(topic) ?? 0) + numRecords);
      }
      pos += 9 + bodyLen;
    }
  }
  const result = {};
  for (const [topic, times] of rawTimes) {
    times.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const n = times.length;
    const relTimes = new Float64Array(n);
    for (let i = 0; i < n; i++) relTimes[i] = Number(times[i] - startNs);
    const totalBytes = topicTotalBytes.get(topic) ?? 0;
    const totalCount = topicTotalCount.get(topic) ?? n;
    const avgSize = totalCount > 0 ? Math.round(totalBytes / totalCount) : 100;
    result[topic] = { times: relTimes, sizes: new Uint32Array(n).fill(avgSize) };
  }
  return result;
}
var TEXT_DEC = new TextDecoder();

// src/parsers/db3.ts
var sqlPromise = null;
function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const sqlJsModule = await Promise.resolve().then(() => __toESM(require_sql_wasm(), 1));
      const initSqlJs = sqlJsModule.default ?? sqlJsModule;
      return initSqlJs({
        locateFile: (f2) => __dirname + "/" + f2
      });
    })();
  }
  return sqlPromise;
}
var cachedDb = null;
function disposeCachedDb() {
  if (cachedDb) {
    try {
      cachedDb.db.close();
    } catch {
    }
    cachedDb = null;
  }
}
async function loadDb(source) {
  const key = sourceKey(source);
  if (cachedDb && cachedDb.sourceKey === key) {
    return cachedDb;
  }
  disposeCachedDb();
  const SQL = await getSqlJs();
  const buffer = await sourceReadAll(source);
  const db = new SQL.Database(buffer);
  const topicTypeByName = /* @__PURE__ */ new Map();
  const topicsResult = db.exec(`SELECT name, type FROM topics`);
  if (topicsResult.length > 0) {
    for (const row of topicsResult[0].values) {
      topicTypeByName.set(row[0], row[1]);
    }
  }
  cachedDb = {
    sourceKey: key,
    displayName: sourceDisplayName(source),
    size: sourceSize(source),
    db,
    topicTypeByName,
    messageCache: /* @__PURE__ */ new Map()
  };
  return cachedDb;
}
async function parseDb3(source) {
  const meta = await loadDb(source);
  const { db } = meta;
  const topics = queryTopics(db);
  const { startTime, endTime, messageCounts } = queryMessageStats(db);
  for (const topic of topics) {
    topic.messageCount = messageCounts.get(topic.name) ?? 0;
  }
  const durationNs = endTime - startTime;
  const duration = Number(durationNs) / 1e9;
  const totalMessageCount = topics.reduce((sum, t) => sum + t.messageCount, 0);
  if (duration > 0) {
    for (const topic of topics) {
      topic.frequency = Math.round(topic.messageCount / duration * 10) / 10;
    }
  }
  return {
    format: "db3",
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name))
  };
}
function queryTopics(db) {
  const results = db.exec(`
    SELECT id, name, type, serialization_format
    FROM topics
  `);
  if (results.length === 0) return [];
  const { values } = results[0];
  return values.map((row) => ({
    name: row[1],
    type: row[2],
    messageCount: 0,
    serializationFormat: row[3] || "cdr"
  }));
}
function queryMessageStats(db) {
  const timeResult = db.exec(`SELECT MIN(timestamp), MAX(timestamp) FROM messages`);
  let startTime = 0n;
  let endTime = 0n;
  if (timeResult.length > 0 && timeResult[0].values.length > 0) {
    const [minTs, maxTs] = timeResult[0].values[0];
    if (minTs != null) startTime = BigInt(minTs);
    if (maxTs != null) endTime = BigInt(maxTs);
  }
  const countResult = db.exec(`
    SELECT t.name, COUNT(m.id) as msg_count
    FROM messages m
    JOIN topics t ON m.topic_id = t.id
    GROUP BY t.name
  `);
  const messageCounts = /* @__PURE__ */ new Map();
  if (countResult.length > 0) {
    for (const row of countResult[0].values) {
      messageCounts.set(row[0], row[1]);
    }
  }
  return { startTime, endTime, messageCounts };
}
var DB3_MAX_TOTAL_SAMPLES = 1e5;
async function readAllMessageStatsDb3(source) {
  const { db } = await loadDb(source);
  const timeResult = db.exec("SELECT MIN(timestamp), COUNT(*) FROM messages");
  let startNs = 0n;
  let totalMessages = 0;
  if (timeResult.length > 0 && timeResult[0].values.length > 0) {
    const row = timeResult[0].values[0];
    if (row[0] != null) startNs = BigInt(row[0]);
    if (row[1] != null) totalMessages = row[1];
  }
  const step = Math.max(1, Math.floor(totalMessages / DB3_MAX_TOTAL_SAMPLES));
  const sql = step <= 1 ? `SELECT t.name, m.timestamp, LENGTH(m.data)
       FROM messages m
       JOIN topics t ON m.topic_id = t.id
       ORDER BY m.timestamp ASC` : `SELECT t.name, m.timestamp, LENGTH(m.data)
       FROM messages m
       JOIN topics t ON m.topic_id = t.id
       WHERE (m.rowid - 1) % ${step} = 0
       ORDER BY m.timestamp ASC`;
  const stmt = db.prepare(sql);
  const rawTimes = /* @__PURE__ */ new Map();
  const rawSizes = /* @__PURE__ */ new Map();
  try {
    while (stmt.step()) {
      const row = stmt.get();
      const topic = row[0];
      const ts = row[1];
      const size = row[2];
      const tsNs = typeof ts === "bigint" ? ts : BigInt(ts);
      const relNs = Number(tsNs - startNs);
      let t = rawTimes.get(topic);
      if (!t) {
        t = [];
        rawTimes.set(topic, t);
      }
      t.push(relNs);
      let s = rawSizes.get(topic);
      if (!s) {
        s = [];
        rawSizes.set(topic, s);
      }
      s.push(size);
    }
  } finally {
    stmt.free();
  }
  const result = {};
  for (const [topic, times] of rawTimes) {
    result[topic] = {
      times: new Float64Array(times),
      sizes: new Uint32Array(rawSizes.get(topic))
    };
  }
  return result;
}

// src/parsers/bag.ts
var import_rosbag = __toESM(require_cjs2(), 1);
var import_web = __toESM(require_web(), 1);
var import_seek_bzip = __toESM(require_lib(), 1);
var lz4 = __toESM(require_lz4(), 1);
function filelikeFor(source) {
  if (source.kind === "file") return new import_web.BlobReader(source.file);
  return new HttpFilelike(source.url, source.contentLength);
}
var cached2 = null;
function decompressBz2(buffer, size) {
  const decoded = import_seek_bzip.default.decode(buffer);
  if (decoded.length > size) return decoded.subarray(0, size);
  return decoded;
}
function decompressLz4(buffer, size) {
  const decoded = lz4.decompress(buffer, size);
  if (decoded.length > size) return decoded.subarray(0, size);
  return decoded;
}
var decompress3 = {
  bz2: decompressBz2,
  lz4: decompressLz4
};
function timeToNs(t) {
  if (!t) return 0n;
  return BigInt(t.sec) * 1000000000n + BigInt(t.nsec);
}
function normalizeTypeName(raw) {
  if (!raw) return "unknown";
  if (raw.includes("/msg/")) return raw;
  const parts = raw.split("/");
  if (parts.length === 2) return `${parts[0]}/msg/${parts[1]}`;
  return raw;
}
async function loadBag(source) {
  const key = sourceKey(source);
  if (cached2 && cached2.sourceKey === key) {
    return cached2;
  }
  const reader = filelikeFor(source);
  const bag = new import_rosbag.Bag(reader, { decompress: decompress3 });
  await bag.open();
  const connectionsById = /* @__PURE__ */ new Map();
  const topicMeta = /* @__PURE__ */ new Map();
  for (const [connId, conn] of bag.connections) {
    const normalizedType = normalizeTypeName(conn.type);
    connectionsById.set(connId, {
      conn: connId,
      topic: conn.topic,
      type: normalizedType,
      rawType: conn.type ?? "unknown",
      messageDefinition: conn.messageDefinition
    });
    if (!topicMeta.has(conn.topic)) {
      topicMeta.set(conn.topic, {
        type: normalizedType,
        messageDefinition: conn.messageDefinition
      });
    }
  }
  cached2 = {
    sourceKey: key,
    displayName: sourceDisplayName(source),
    size: sourceSize(source),
    bag,
    connectionsById,
    topicMeta,
    messageCache: /* @__PURE__ */ new Map()
  };
  return cached2;
}
async function parseBagFile(source) {
  const meta = await loadBag(source);
  const { bag } = meta;
  const startTime = timeToNs(bag.startTime);
  const endTime = timeToNs(bag.endTime);
  const duration = Number(endTime - startTime) / 1e9;
  const messageCountByConn = /* @__PURE__ */ new Map();
  for (const chunkInfo of bag.chunkInfos) {
    for (const { conn, count } of chunkInfo.connections) {
      messageCountByConn.set(conn, (messageCountByConn.get(conn) ?? 0) + count);
    }
  }
  const countByTopic = /* @__PURE__ */ new Map();
  for (const [connId, conn] of meta.connectionsById) {
    const c = messageCountByConn.get(connId) ?? 0;
    countByTopic.set(conn.topic, (countByTopic.get(conn.topic) ?? 0) + c);
  }
  const topics = [];
  for (const [topicName, info] of meta.topicMeta) {
    const messageCount = countByTopic.get(topicName) ?? 0;
    topics.push({
      name: topicName,
      type: info.type,
      messageCount,
      serializationFormat: "ros1",
      frequency: duration > 0 ? Math.round(messageCount / duration * 10) / 10 : void 0
    });
  }
  const totalMessageCount = topics.reduce((sum, t) => sum + t.messageCount, 0);
  return {
    format: "bag",
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name))
  };
}
var BAG_MAX_SAMPLES_PER_TOPIC = 5e4;
async function readAllMessageStatsBag(source) {
  const meta = await loadBag(source);
  const { bag } = meta;
  const startNs = timeToNs(bag.startTime);
  const connCount = /* @__PURE__ */ new Map();
  for (const chunkInfo of bag.chunkInfos) {
    for (const { conn, count } of chunkInfo.connections) {
      connCount.set(conn, (connCount.get(conn) ?? 0) + count);
    }
  }
  const topicTotal = /* @__PURE__ */ new Map();
  for (const [connId, conn] of meta.connectionsById) {
    const c = connCount.get(connId) ?? 0;
    topicTotal.set(conn.topic, (topicTotal.get(conn.topic) ?? 0) + c);
  }
  const topicStep = /* @__PURE__ */ new Map();
  const topicCounter = /* @__PURE__ */ new Map();
  for (const [topic, total] of topicTotal) {
    topicStep.set(topic, Math.max(1, Math.floor(total / BAG_MAX_SAMPLES_PER_TOPIC)));
  }
  const rawTimes = /* @__PURE__ */ new Map();
  const rawSizes = /* @__PURE__ */ new Map();
  const iterator = bag.messageIterator({});
  for await (const event of iterator) {
    const { topic } = event;
    const counter = (topicCounter.get(topic) ?? 0) + 1;
    topicCounter.set(topic, counter);
    const step = topicStep.get(topic) ?? 1;
    if ((counter - 1) % step !== 0) continue;
    const relNs = Number(timeToNs(event.timestamp) - startNs);
    let t = rawTimes.get(topic);
    if (!t) {
      t = [];
      rawTimes.set(topic, t);
    }
    t.push(relNs);
    let s = rawSizes.get(topic);
    if (!s) {
      s = [];
      rawSizes.set(topic, s);
    }
    s.push(event.data.byteLength);
  }
  const result = {};
  for (const [topic, times] of rawTimes) {
    result[topic] = {
      times: new Float64Array(times),
      sizes: new Uint32Array(rawSizes.get(topic))
    };
  }
  return result;
}

// src/utils/pointcloud.ts
var POINT_FIELD_TYPE = {
  INT8: 1,
  UINT8: 2,
  INT16: 3,
  UINT16: 4,
  INT32: 5,
  UINT32: 6,
  FLOAT32: 7,
  FLOAT64: 8
};
var TURBO_LUT_SIZE = 1024;
var TURBO_LUT_LAST = TURBO_LUT_SIZE - 1;
var TURBO_R = new Float32Array(TURBO_LUT_SIZE);
var TURBO_G = new Float32Array(TURBO_LUT_SIZE);
var TURBO_B = new Float32Array(TURBO_LUT_SIZE);
for (let i = 0; i < TURBO_LUT_SIZE; i++) {
  const x = i / TURBO_LUT_LAST;
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;
  const x5 = x4 * x;
  TURBO_R[i] = clamp01(
    0.13572138 + 4.6153926 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5
  );
  TURBO_G[i] = clamp01(
    0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5
  );
  TURBO_B[i] = clamp01(
    0.1066733 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5
  );
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// src/parsers/pcd.ts
var pcdCloudCache = /* @__PURE__ */ new Map();
var pcdSummaryCache = /* @__PURE__ */ new Map();
var PCD_MAGIC = "# .PCD";
function pcdTypeToPc2Datatype(type, size) {
  const t = type.toUpperCase();
  if (t === "F") return size === 8 ? POINT_FIELD_TYPE.FLOAT64 : POINT_FIELD_TYPE.FLOAT32;
  if (t === "I") {
    if (size === 1) return POINT_FIELD_TYPE.INT8;
    if (size === 2) return POINT_FIELD_TYPE.INT16;
    return POINT_FIELD_TYPE.INT32;
  }
  if (size === 1) return POINT_FIELD_TYPE.UINT8;
  if (size === 2) return POINT_FIELD_TYPE.UINT16;
  return POINT_FIELD_TYPE.UINT32;
}
function parsePcdHeader(bytes) {
  let windowSize = Math.min(4096, bytes.length);
  const decoder = new TextDecoder("ascii");
  for (; ; ) {
    const text = decoder.decode(bytes.subarray(0, windowSize));
    const atEof = windowSize >= bytes.length;
    const header = {};
    let dataByteOffset = 0;
    let dataFound = false;
    let grow = false;
    let lineStart = 0;
    for (let i = 0; i <= text.length; i++) {
      const atSyntheticEnd = i === text.length;
      const ch = atSyntheticEnd ? "\n" : text[i];
      if (ch !== "\n" && ch !== "\r") continue;
      const rawLine = text.slice(lineStart, i);
      lineStart = i + 1;
      if (rawLine === "") continue;
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      const keyword = parts[0].toUpperCase();
      const values = parts.slice(1);
      switch (keyword) {
        case "FIELDS":
          header.fields = values.map((v) => v.toLowerCase());
          break;
        case "SIZE":
          header.sizes = values.map(Number);
          break;
        case "TYPE":
          header.types = values;
          break;
        case "COUNT":
          header.counts = values.map(Number);
          break;
        case "WIDTH":
          header.width = Number(values[0]);
          break;
        case "HEIGHT":
          header.height = Number(values[0]);
          break;
        case "POINTS":
          header.points = Number(values[0]);
          break;
        case "DATA": {
          const crAtWindowEdge = ch === "\r" && i + 1 >= text.length;
          if ((atSyntheticEnd || crAtWindowEdge) && !atEof) {
            grow = true;
            break;
          }
          const enc = (values[0] ?? "ascii").toLowerCase();
          header.dataEncoding = enc === "binary_compressed" ? "binary_compressed" : enc === "binary" ? "binary" : "ascii";
          if (atSyntheticEnd) dataByteOffset = text.length;
          else if (ch === "\n") dataByteOffset = i + 1;
          else if (i + 1 < text.length && text[i + 1] === "\n") dataByteOffset = i + 2;
          else dataByteOffset = i + 1;
          dataFound = true;
          i = text.length + 1;
          break;
        }
      }
      if (grow) break;
    }
    if (grow || !dataFound && !atEof) {
      windowSize = Math.min(windowSize * 2, bytes.length);
      continue;
    }
    if (!header.fields || !header.sizes || !header.types || !header.counts || header.points === void 0 || header.dataEncoding === void 0) {
      throw new Error("PCD file has an incomplete header (missing FIELDS / SIZE / TYPE / POINTS / DATA).");
    }
    const completeHeader = header;
    if (!completeHeader.width) completeHeader.width = completeHeader.points;
    if (!completeHeader.height) completeHeader.height = 1;
    return { header: completeHeader, dataByteOffset };
  }
}
function lzfDecompress(compressed, outputLen) {
  const out = new Uint8Array(outputLen);
  let iPos = 0;
  let oPos = 0;
  while (iPos < compressed.length) {
    const ctrl = compressed[iPos++];
    if (ctrl < 32) {
      const count = ctrl + 1;
      for (let k = 0; k < count; k++) {
        out[oPos++] = compressed[iPos++];
      }
    } else {
      let len = ctrl >> 5;
      if (len === 7) len += compressed[iPos++];
      len += 2;
      const backOffset = ((ctrl & 31) << 8) + compressed[iPos++] + 1;
      let srcPos = oPos - backOffset;
      for (let k = 0; k < len; k++) {
        out[oPos++] = out[srcPos++];
      }
    }
  }
  return out;
}
function buildBinaryCloud(rawData, header) {
  const fields = [];
  let offset = 0;
  for (let i = 0; i < header.fields.length; i++) {
    const name = header.fields[i];
    const size = header.sizes[i] ?? 4;
    const type = header.types[i] ?? "F";
    const count = header.counts[i] ?? 1;
    for (let c = 0; c < count; c++) {
      fields.push({
        name: count === 1 ? name : `${name}_${c}`,
        offset,
        datatype: pcdTypeToPc2Datatype(type, size),
        count: 1
      });
      offset += size;
    }
  }
  const pointStep = offset;
  const width = header.width || header.points;
  const height = header.height || 1;
  const dataBuf = header.points === 0 ? new Uint8Array(0) : rawData.slice(0, header.points * pointStep);
  return {
    height,
    width,
    fields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * width,
    data: dataBuf
  };
}
function buildAsciiCloud(text, header) {
  const fields = [];
  let totalFields = 0;
  for (let i = 0; i < header.fields.length; i++) {
    const count = header.counts[i] ?? 1;
    totalFields += count;
    for (let c = 0; c < count; c++) {
      fields.push({
        name: count === 1 ? header.fields[i] : `${header.fields[i]}_${c}`,
        offset: fields.length * 4,
        datatype: POINT_FIELD_TYPE.FLOAT32,
        count: 1
      });
    }
  }
  const pointStep = totalFields * 4;
  const points = header.points;
  const data = new Uint8Array(points * pointStep);
  const view = new DataView(data.buffer);
  const lines = text.split("\n");
  let validPt = 0;
  for (let li = 0; li < lines.length && validPt < points; li++) {
    const line = lines[li].trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < totalFields) continue;
    const base = validPt * pointStep;
    for (let fi = 0; fi < totalFields; fi++) {
      view.setFloat32(base + fi * 4, parseFloat(tokens[fi]), true);
    }
    validPt++;
  }
  return {
    height: 1,
    width: validPt,
    fields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * validPt,
    data: data.subarray(0, validPt * pointStep)
  };
}
function pcdPointStep(header) {
  let step = 0;
  for (let i = 0; i < header.fields.length; i++) {
    step += (header.sizes[i] ?? 4) * (header.counts[i] ?? 1);
  }
  return step;
}
async function loadPcdCloud(source) {
  const key = sourceKey(source);
  const cached3 = pcdCloudCache.get(key);
  if (cached3) return cached3;
  const bytes = await sourceReadAll(source);
  const { header, dataByteOffset } = parsePcdHeader(bytes);
  const expectedBytes = header.points * pcdPointStep(header);
  let cloud;
  if (header.dataEncoding === "binary_compressed") {
    const remaining = bytes.length - dataByteOffset;
    if (remaining < 8) {
      throw new Error(`PCD: truncated binary_compressed payload (missing 8-byte size header, have ${remaining} bytes).`);
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset + dataByteOffset);
    const compressedSize = dv.getUint32(0, true);
    const uncompressedSize = dv.getUint32(4, true);
    if (remaining - 8 < compressedSize) {
      throw new Error(`PCD: truncated binary_compressed payload (declares ${compressedSize} compressed bytes, have ${remaining - 8}).`);
    }
    const compressed = bytes.subarray(dataByteOffset + 8, dataByteOffset + 8 + compressedSize);
    const uncompressed = lzfDecompress(compressed, uncompressedSize);
    if (uncompressed.length < expectedBytes) {
      throw new Error(`PCD: truncated binary_compressed payload (declares ${uncompressedSize} uncompressed bytes, need ${expectedBytes} for ${header.points} points).`);
    }
    cloud = buildBinaryCloud(uncompressed, header);
  } else if (header.dataEncoding === "binary") {
    const rawData = bytes.subarray(dataByteOffset);
    if (rawData.length < expectedBytes) {
      throw new Error(`PCD: truncated binary payload (need ${expectedBytes} bytes for ${header.points} points, have ${rawData.length}).`);
    }
    cloud = buildBinaryCloud(rawData, header);
  } else {
    const dataText = new TextDecoder("ascii").decode(bytes.subarray(dataByteOffset));
    cloud = buildAsciiCloud(dataText, header);
  }
  pcdCloudCache.set(key, cloud);
  return cloud;
}
async function parsePcd(source) {
  const key = sourceKey(source);
  const cached3 = pcdSummaryCache.get(key);
  if (cached3) return cached3;
  await loadPcdCloud(source);
  const summary = {
    format: "pcd",
    fileName: source.kind === "file" ? source.file.name : source.displayName,
    fileSize: source.kind === "file" ? source.file.size : source.contentLength,
    startTime: 0n,
    endTime: 1000000n,
    // 1 ms so the timeline doesn't collapse to zero
    duration: 1e-3,
    totalMessageCount: 1,
    topics: [
      {
        name: "/cloud",
        type: "sensor_msgs/PointCloud2",
        messageCount: 1,
        serializationFormat: "pcd",
        frequency: void 0
      }
    ]
  };
  pcdSummaryCache.set(key, summary);
  return summary;
}

// src/parsers/ply.ts
var plyCloudCache = /* @__PURE__ */ new Map();
var plySummaryCache = /* @__PURE__ */ new Map();
var PLY_MAGIC = "ply";
function plyTypeInfo(typeName) {
  switch (typeName.toLowerCase()) {
    case "float32":
    case "float":
      return { byteSize: 4, isFloat: true, isUnsigned: false };
    case "float64":
    case "double":
      return { byteSize: 8, isFloat: true, isUnsigned: false };
    case "char":
    case "int8":
      return { byteSize: 1, isFloat: false, isUnsigned: false };
    case "uchar":
    case "uint8":
      return { byteSize: 1, isFloat: false, isUnsigned: true };
    case "short":
    case "int16":
      return { byteSize: 2, isFloat: false, isUnsigned: false };
    case "ushort":
    case "uint16":
      return { byteSize: 2, isFloat: false, isUnsigned: true };
    case "int":
    case "int32":
      return { byteSize: 4, isFloat: false, isUnsigned: false };
    case "uint":
    case "uint32":
      return { byteSize: 4, isFloat: false, isUnsigned: false };
    default:
      return { byteSize: 4, isFloat: false, isUnsigned: false };
  }
}
function parsePlyHeader(bytes) {
  const headSlice = bytes.subarray(0, Math.min(8192, bytes.length));
  const text = new TextDecoder("ascii").decode(headSlice);
  let format = "ascii";
  let vertexCount = 0;
  const props = [];
  let inVertexElement = false;
  let dataByteOffset = 0;
  const lines = text.split("\n");
  let consumedBytes = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    consumedBytes += raw.length + 1;
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const kw = parts[0];
    if (kw === "format") {
      const fmt = parts[1];
      format = fmt === "binary_little_endian" ? "binary_little_endian" : fmt === "binary_big_endian" ? "binary_big_endian" : "ascii";
    } else if (kw === "element") {
      inVertexElement = parts[1] === "vertex";
      if (inVertexElement) vertexCount = Number(parts[2]);
    } else if (kw === "property" && inVertexElement) {
      if (parts[1] === "list") continue;
      const typeName = parts[1] ?? "float";
      const propName = parts[2] ?? "";
      const { byteSize, isFloat, isUnsigned } = plyTypeInfo(typeName);
      props.push({ name: propName, typeName, byteSize, isFloat, isUnsigned });
    } else if (kw === "end_header") {
      dataByteOffset = consumedBytes;
      break;
    }
  }
  if (dataByteOffset === 0) {
    throw new Error('PLY file missing "end_header" marker.');
  }
  if (props.length === 0 || !props.some((p) => p.name === "x")) {
    throw new Error("PLY file has no vertex x/y/z properties.");
  }
  return { format, vertexCount, props, dataByteOffset };
}
function readPlyValue(view, offset, prop, littleEndian) {
  const { byteSize, isFloat, isUnsigned } = prop;
  if (isFloat) {
    return byteSize === 8 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian);
  }
  if (byteSize === 1) return isUnsigned ? view.getUint8(offset) : view.getInt8(offset);
  if (byteSize === 2)
    return isUnsigned ? view.getUint16(offset, littleEndian) : view.getInt16(offset, littleEndian);
  return isUnsigned ? view.getUint32(offset, littleEndian) : view.getInt32(offset, littleEndian);
}
function packRgb(r, g, b) {
  const packed = (r & 255) << 16 | (g & 255) << 8 | b & 255;
  const tmp = new DataView(new ArrayBuffer(4));
  tmp.setUint32(0, packed, true);
  return tmp.getFloat32(0, true);
}
function buildPlyCloud(bytes, header) {
  const { format, vertexCount, props, dataByteOffset } = header;
  const littleEndian = format !== "binary_big_endian";
  const hasX = props.some((p) => p.name === "x");
  const hasY = props.some((p) => p.name === "y");
  const hasZ = props.some((p) => p.name === "z");
  const hasRed = props.some((p) => p.name === "red");
  const hasGreen = props.some((p) => p.name === "green");
  const hasBlue = props.some((p) => p.name === "blue");
  const hasRgbFloat = props.some((p) => p.name === "rgb" || p.name === "rgba");
  const hasColor = hasRed && hasGreen && hasBlue;
  const hasColorAny = hasColor || hasRgbFloat;
  const hasIntensity = props.some((p) => p.name === "intensity");
  if (!hasX || !hasY || !hasZ) {
    throw new Error("PLY file missing x/y/z vertex properties.");
  }
  const outFields = [
    { name: "x", offset: 0, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: "y", offset: 4, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: "z", offset: 8, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 }
  ];
  let nextOffset = 12;
  if (hasColorAny) {
    outFields.push({ name: "rgb", offset: nextOffset, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 });
    nextOffset += 4;
  }
  if (hasIntensity) {
    outFields.push({ name: "intensity", offset: nextOffset, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 });
    nextOffset += 4;
  }
  const pointStep = nextOffset;
  const outData = new Uint8Array(vertexCount * pointStep);
  const outView = new DataView(outData.buffer);
  if (format === "ascii") {
    const textData = new TextDecoder("ascii").decode(bytes.subarray(dataByteOffset));
    const lines = textData.split("\n");
    let ptIdx = 0;
    const propIdx = new Map(props.map((p, i) => [p.name, i]));
    for (let li = 0; li < lines.length && ptIdx < vertexCount; li++) {
      const line = lines[li].trim();
      if (!line || line.startsWith("#")) continue;
      const tokens = line.split(/\s+/);
      if (tokens.length < props.length) continue;
      const base = ptIdx * pointStep;
      const xTok = propIdx.get("x") ?? -1;
      const yTok = propIdx.get("y") ?? -1;
      const zTok = propIdx.get("z") ?? -1;
      outView.setFloat32(base + 0, xTok >= 0 ? parseFloat(tokens[xTok]) : 0, true);
      outView.setFloat32(base + 4, yTok >= 0 ? parseFloat(tokens[yTok]) : 0, true);
      outView.setFloat32(base + 8, zTok >= 0 ? parseFloat(tokens[zTok]) : 0, true);
      if (hasColorAny) {
        const rgbOff = 12;
        if (hasColor) {
          const rIdx = propIdx.get("red") ?? -1;
          const gIdx = propIdx.get("green") ?? -1;
          const bIdx = propIdx.get("blue") ?? -1;
          const r = rIdx >= 0 ? parseFloat(tokens[rIdx]) : 0;
          const g = gIdx >= 0 ? parseFloat(tokens[gIdx]) : 0;
          const b = bIdx >= 0 ? parseFloat(tokens[bIdx]) : 0;
          const redProp = props.find((p) => p.name === "red");
          const scale = redProp && !redProp.isFloat ? 1 : Math.max(r, g, b) > 1 ? 1 : 255;
          outView.setFloat32(base + rgbOff, packRgb(
            Math.round(r * scale),
            Math.round(g * scale),
            Math.round(b * scale)
          ), true);
        } else if (hasRgbFloat) {
          const rIdx = propIdx.get("rgb") ?? propIdx.get("rgba") ?? -1;
          if (rIdx >= 0) {
            outView.setFloat32(base + rgbOff, parseFloat(tokens[rIdx]), true);
          }
        }
      }
      if (hasIntensity) {
        const iIdx = propIdx.get("intensity") ?? -1;
        const intOff = hasColorAny ? 16 : 12;
        outView.setFloat32(base + intOff, iIdx >= 0 ? parseFloat(tokens[iIdx]) : 0, true);
      }
      ptIdx++;
    }
  } else {
    const binData = bytes.subarray(dataByteOffset);
    const binView = new DataView(binData.buffer, binData.byteOffset, binData.byteLength);
    let propBinOff = 0;
    const propOffsets = props.map((p) => {
      const off = propBinOff;
      propBinOff += p.byteSize;
      return off;
    });
    const binaryPointStep = propBinOff;
    if (binData.byteLength < vertexCount * binaryPointStep) {
      throw new Error(
        `PLY: truncated vertex data (need ${vertexCount * binaryPointStep} bytes for ${vertexCount} points, have ${binData.byteLength}).`
      );
    }
    const getPropVal = (ptBase, propName) => {
      const idx = props.findIndex((p) => p.name === propName);
      if (idx < 0) return 0;
      return readPlyValue(binView, ptBase + propOffsets[idx], props[idx], littleEndian);
    };
    for (let pi = 0; pi < vertexCount; pi++) {
      const binBase = pi * binaryPointStep;
      const outBase = pi * pointStep;
      outView.setFloat32(outBase + 0, getPropVal(binBase, "x"), true);
      outView.setFloat32(outBase + 4, getPropVal(binBase, "y"), true);
      outView.setFloat32(outBase + 8, getPropVal(binBase, "z"), true);
      if (hasColorAny) {
        const rgbOff = 12;
        if (hasColor) {
          const r = getPropVal(binBase, "red");
          const g = getPropVal(binBase, "green");
          const b = getPropVal(binBase, "blue");
          const redProp = props.find((p) => p.name === "red");
          const scale = redProp && redProp.isFloat ? 255 : 1;
          outView.setFloat32(outBase + rgbOff, packRgb(
            Math.round(r * scale),
            Math.round(g * scale),
            Math.round(b * scale)
          ), true);
        } else if (hasRgbFloat) {
          const raw = getPropVal(binBase, "rgb") || getPropVal(binBase, "rgba");
          outView.setFloat32(outBase + rgbOff, raw, true);
        }
      }
      if (hasIntensity) {
        const intOff = hasColorAny ? 16 : 12;
        outView.setFloat32(outBase + intOff, getPropVal(binBase, "intensity"), true);
      }
    }
  }
  return {
    height: 1,
    width: vertexCount,
    fields: outFields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * vertexCount,
    data: outData
  };
}
async function loadPlyCloud(source) {
  const key = sourceKey(source);
  const cached3 = plyCloudCache.get(key);
  if (cached3) return cached3;
  const bytes = await sourceReadAll(source);
  const header = parsePlyHeader(bytes);
  const cloud = buildPlyCloud(bytes, header);
  plyCloudCache.set(key, cloud);
  return cloud;
}
async function parsePly(source) {
  const key = sourceKey(source);
  const cached3 = plySummaryCache.get(key);
  if (cached3) return cached3;
  await loadPlyCloud(source);
  const summary = {
    format: "ply",
    fileName: source.kind === "file" ? source.file.name : source.displayName,
    fileSize: source.kind === "file" ? source.file.size : source.contentLength,
    startTime: 0n,
    endTime: 1000000n,
    duration: 1e-3,
    totalMessageCount: 1,
    topics: [
      {
        name: "/cloud",
        type: "sensor_msgs/PointCloud2",
        messageCount: 1,
        serializationFormat: "ply",
        frequency: void 0
      }
    ]
  };
  plySummaryCache.set(key, summary);
  return summary;
}

// src/parsers/splat.ts
var SPLAT_TYPE = "gaussian/GaussianSplat";
var SPLAT_RECORD_BYTES = 32;
var splatSummaryCache = /* @__PURE__ */ new Map();
function isSplatPly(bytes) {
  try {
    const header = parsePlyHeader(bytes);
    return header.props.some((p) => p.name === "f_dc_0" || p.name === "opacity" || p.name === "scale_0" || p.name === "rot_0");
  } catch {
    return false;
  }
}
async function estimateSplatCount(source) {
  const name = sourceDisplayName(source).toLowerCase();
  if (name.endsWith(".splat")) {
    return Math.floor(sourceSize(source) / SPLAT_RECORD_BYTES);
  }
  if (name.endsWith(".ply")) {
    const head = await sourceReadSlice(source, 0, 8192);
    try {
      return parsePlyHeader(head).vertexCount;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
async function parseSplat(source) {
  const key = sourceKey(source);
  const cached3 = splatSummaryCache.get(key);
  if (cached3) return cached3;
  const splatCount = await estimateSplatCount(source);
  const summary = {
    format: "splat",
    fileName: sourceDisplayName(source),
    fileSize: sourceSize(source),
    startTime: 0n,
    endTime: 1000000n,
    duration: 1e-3,
    totalMessageCount: 1,
    topics: [
      {
        name: "/splat",
        type: SPLAT_TYPE,
        messageCount: splatCount ?? 1,
        serializationFormat: "splat",
        frequency: void 0
      }
    ]
  };
  splatSummaryCache.set(key, summary);
  return summary;
}

// src/utils/bytes.ts
function checkMagicBytes(data, expected) {
  if (data.length < expected.length) return false;
  return expected.every((byte, i) => data[i] === byte);
}

// src/parsers/multi.ts
var SPLITTABLE = ["mcap", "db3", "bag"];
var loadedCache = /* @__PURE__ */ new Map();
function mergeSummaries(displayName, parts) {
  const first = parts[0];
  let start = first.startTime;
  let end = first.endTime;
  let totalMessageCount = 0;
  let fileSize = 0;
  const topics = /* @__PURE__ */ new Map();
  for (const p of parts) {
    if (p.startTime < start) start = p.startTime;
    if (p.endTime > end) end = p.endTime;
    totalMessageCount += p.totalMessageCount;
    fileSize += p.fileSize;
    for (const t of p.topics) {
      const existing = topics.get(t.name);
      if (existing) existing.messageCount += t.messageCount;
      else topics.set(t.name, { ...t });
    }
  }
  const duration = Number(end - start) / 1e9;
  for (const t of topics.values()) {
    if (t.frequency !== void 0) t.frequency = duration > 0 ? t.messageCount / duration : t.frequency;
  }
  return {
    ...first,
    fileName: displayName,
    fileSize,
    startTime: start,
    endTime: end,
    duration,
    totalMessageCount,
    topics: [...topics.values()]
  };
}
async function load(multi) {
  const key = sourceKey(multi);
  const hit = loadedCache.get(key);
  if (hit) return hit;
  const promise = (async () => {
    if (multi.parts.length === 0) throw new Error("A split recording needs at least one file.");
    const parts = [];
    let format = null;
    for (const source of multi.parts) {
      const detected = await detectFormat(source);
      if (detected === "unknown" || !SPLITTABLE.includes(detected)) {
        throw new Error(
          `"${sourceDisplayName(source)}" is not an .mcap, .db3 or .bag file, so it cannot be combined into one recording.`
        );
      }
      if (format && detected !== format) {
        throw new Error(
          `These files are not all the same format: "${sourceDisplayName(source)}" is ${detected} but the earlier parts are ${format}. Open them as separate bags instead.`
        );
      }
      const summary = await parseBag(source);
      format = summary.format;
      if (summary.totalMessageCount === 0) continue;
      parts.push({ source, summary, topics: new Set(summary.topics.map((t) => t.name)) });
    }
    if (!format) throw new Error("A split recording needs at least one file.");
    if (parts.length === 0) {
      const empty = await parseBag(multi.parts[0]);
      return { parts: [], format, summary: { ...empty, fileName: multi.displayName } };
    }
    parts.sort(
      (a, b) => a.summary.startTime < b.summary.startTime ? -1 : a.summary.startTime > b.summary.startTime ? 1 : 0
    );
    return { parts, format, summary: mergeSummaries(multi.displayName, parts.map((p) => p.summary)) };
  })();
  loadedCache.set(key, promise);
  promise.catch(() => loadedCache.delete(key));
  return promise;
}
async function parseMulti(multi) {
  return (await load(multi)).summary;
}
async function formatOfMulti(multi) {
  return (await load(multi)).format;
}
async function readAllMessageStatsMulti(multi, format) {
  const { parts, summary } = await load(multi);
  const timeChunks = /* @__PURE__ */ new Map();
  const sizeChunks = /* @__PURE__ */ new Map();
  for (const p of parts) {
    const stats = await readAllMessageStats(p.source, format);
    const shift = Number(p.summary.startTime - summary.startTime);
    for (const [topic, { times, sizes }] of Object.entries(stats)) {
      const shifted = new Float64Array(times.length);
      for (let i = 0; i < times.length; i++) shifted[i] = times[i] + shift;
      (timeChunks.get(topic) ?? timeChunks.set(topic, []).get(topic)).push(shifted);
      (sizeChunks.get(topic) ?? sizeChunks.set(topic, []).get(topic)).push(sizes);
    }
  }
  const result = {};
  for (const [topic, chunks] of timeChunks) {
    const sizeParts = sizeChunks.get(topic);
    const times = new Float64Array(chunks.reduce((n, c) => n + c.length, 0));
    const sizes = new Uint32Array(times.length);
    let at = 0;
    chunks.forEach((c, i) => {
      times.set(c, at);
      sizes.set(sizeParts[i], at);
      at += c.length;
    });
    result[topic] = { times, sizes };
  }
  return result;
}

// src/parsers/core.ts
var MCAP_MAGIC2 = [137, 77, 67, 65, 80, 48, 13, 10];
var SQLITE_MAGIC = [83, 81, 76, 105, 116, 101];
var ROSBAG_V2_MAGIC = [
  35,
  82,
  79,
  83,
  66,
  65,
  71,
  32,
  86,
  50,
  46,
  48,
  10
];
async function detectFormat(source) {
  if (source.kind === "multi") return formatOfMulti(source);
  const name = sourceDisplayName(source);
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "mcap") return "mcap";
  if (ext === "db3") return "db3";
  if (ext === "bag") return "bag";
  if (ext === "pcd") return "pcd";
  if (ext === "splat" || ext === "ksplat") return "splat";
  if (ext === "ply") {
    const head = await sourceReadSlice(source, 0, 8192);
    return isSplatPly(head) ? "splat" : "ply";
  }
  const header = await sourceReadSlice(source, 0, 16);
  if (checkMagicBytes(header, MCAP_MAGIC2)) return "mcap";
  if (checkMagicBytes(header, SQLITE_MAGIC)) return "db3";
  if (checkMagicBytes(header, ROSBAG_V2_MAGIC)) return "bag";
  const headerText = new TextDecoder("ascii").decode(header);
  if (headerText.startsWith(PCD_MAGIC)) return "pcd";
  if (headerText.startsWith(PLY_MAGIC)) {
    const fullHead = await sourceReadSlice(source, 0, 8192);
    return isSplatPly(fullHead) ? "splat" : "ply";
  }
  return "unknown";
}
async function parseBag(source) {
  if (source.kind === "multi") return parseMulti(source);
  const format = await detectFormat(source);
  switch (format) {
    case "mcap":
      return parseMcap(source);
    case "db3":
      return parseDb3(source);
    case "bag":
      return parseBagFile(source);
    case "pcd":
      return parsePcd(source);
    case "ply":
      return parsePly(source);
    case "splat":
      return parseSplat(source);
    default:
      throw new Error(
        `Unsupported file format: "${sourceDisplayName(source)}". BAGEL supports .mcap, .db3, .bag, .pcd, .ply, .splat, and .ksplat files.`
      );
  }
}
async function readAllMessageStats(source, format) {
  if (source.kind === "multi") return readAllMessageStatsMulti(source, format);
  if (format === "pcd" || format === "ply" || format === "splat") return {};
  if (format === "mcap") return readAllMessageStatsMcap(source);
  if (format === "bag") return readAllMessageStatsBag(source);
  return readAllMessageStatsDb3(source);
}

// src/utils/bagGroups.ts
var SPLITTABLE_EXTENSIONS = ["mcap", "db3", "bag"];
var INGEST_EXTENSIONS = [...SPLITTABLE_EXTENSIONS, "pcd", "ply", "splat", "ksplat"];
function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}
function baseOf(path) {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash < 0 ? path : path.slice(slash + 1);
}
function splitIndex(name) {
  const noExt = name.slice(0, name.lastIndexOf("."));
  const m = /^(.*)_(\d+)$/.exec(noExt);
  if (!m || !m[1]) return null;
  return { stem: m[1], index: Number(m[2]) };
}
function parseRosbag2Metadata(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inList = false;
  let keyIndent = 0;
  for (const line of lines) {
    if (!inList) {
      const m = /^(\s*)relative_file_paths\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      keyIndent = m[1].length;
      const rest = m[2].trim();
      if (rest.startsWith("[")) {
        for (const item2 of rest.replace(/^\[|\]$/g, "").split(",")) {
          const v2 = item2.trim().replace(/^["']|["']$/g, "");
          if (v2) out.push(baseOf(v2));
        }
        return out;
      }
      inList = true;
      continue;
    }
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (!item || indent < keyIndent || indent === keyIndent && !line.trimStart().startsWith("-")) break;
    const v = item[1].trim().replace(/^["']|["']$/g, "");
    if (v) out.push(baseOf(v));
  }
  return out;
}
function partsLabel(stem, found, expected) {
  return found === expected ? `${stem} (${found} parts)` : `${stem} (${found} of ${expected} parts)`;
}
function groupBagFiles(files, metadataText) {
  const supported = files.filter((f2) => INGEST_EXTENSIONS.includes(extOf(f2.name)));
  const claimed = /* @__PURE__ */ new Set();
  const groups = [];
  const orderOf = (f2) => files.indexOf(f2);
  const listed = metadataText ? parseRosbag2Metadata(metadataText) : [];
  if (listed.length > 1) {
    const listedSet = new Set(listed);
    const matched = supported.filter(
      (f2) => SPLITTABLE_EXTENSIONS.includes(extOf(f2.name)) && listedSet.has(f2.name)
    );
    if (matched.length > 1) {
      matched.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
      for (const f2 of matched) claimed.add(f2);
      const idx = splitIndex(matched[0].name);
      const stem = idx?.stem ?? matched[0].name.replace(/\.[^.]+$/, "");
      groups.push({
        order: Math.min(...matched.map(orderOf)),
        group: { files: matched, displayName: partsLabel(stem, matched.length, listed.length), missing: [] }
      });
    }
  }
  const buckets = /* @__PURE__ */ new Map();
  for (const f2 of supported) {
    if (claimed.has(f2)) continue;
    const ext = extOf(f2.name);
    if (!SPLITTABLE_EXTENSIONS.includes(ext)) continue;
    const idx = splitIndex(f2.name);
    if (!idx) continue;
    const key = `${f2.dir ?? ""}\0${ext}\0${idx.stem}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push({ file: f2, index: idx.index });
  }
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.index - b.index);
    if (members[0].index !== 0) continue;
    if (new Set(members.map((m) => m.index)).size !== members.length) continue;
    const have = new Set(members.map((m) => m.index));
    const last = members[members.length - 1].index;
    const missing = [];
    for (let i = 0; i <= last; i++) if (!have.has(i)) missing.push(i + 1);
    const stem = key.split("\0")[2];
    for (const m of members) claimed.add(m.file);
    groups.push({
      order: Math.min(...members.map((m) => orderOf(m.file))),
      group: {
        files: members.map((m) => m.file),
        displayName: partsLabel(stem, members.length, last + 1),
        missing
      }
    });
  }
  for (const f2 of supported) {
    if (claimed.has(f2)) continue;
    groups.push({ order: orderOf(f2), group: { files: [f2], displayName: f2.name, missing: [] } });
  }
  groups.sort((a, b) => a.order - b.order);
  return groups.map((g) => g.group);
}

// src/utils/bagDiff.ts
function normalizeType(type) {
  return type.replace(/\/(msg|srv|action)\//, "/");
}

// src/utils/topicStats.ts
var RATE_WINDOWS = 20;
var GAP_THRESHOLD_MULTIPLE = 3;
var MIN_GAP_SEC = 0.05;
function computeTopicHealth(topic, stats) {
  const { times, sizes } = stats;
  const n = times.length;
  if (n === 0) {
    return {
      topic,
      count: 0,
      durationSec: 0,
      meanHz: 0,
      medianPeriodSec: 0,
      jitterSec: 0,
      gapCount: 0,
      gaps: [],
      bandwidthBytesPerSec: 0,
      rateOverTime: { t: new Float64Array(0), hz: new Float64Array(0) }
    };
  }
  const durationNs = times[n - 1] - times[0];
  const durationSec = durationNs / 1e9;
  const meanHz = durationSec > 0 ? (n - 1) / durationSec : 0;
  const periods = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) periods[i - 1] = (times[i] - times[i - 1]) / 1e9;
  const sorted = Float64Array.from(periods).sort();
  const medianPeriodSec = n > 1 ? sorted[Math.floor(sorted.length / 2)] : 0;
  let jitterSec = 0;
  if (periods.length > 1) {
    let sum = 0;
    for (let i = 0; i < periods.length; i++) sum += periods[i];
    const mean = sum / periods.length;
    let sqSum = 0;
    for (let i = 0; i < periods.length; i++) sqSum += (periods[i] - mean) ** 2;
    jitterSec = Math.sqrt(sqSum / periods.length);
  }
  const gapThreshold = medianPeriodSec * GAP_THRESHOLD_MULTIPLE;
  const gaps = [];
  for (let i = 0; i < periods.length; i++) {
    if (periods[i] > gapThreshold && periods[i] > MIN_GAP_SEC) {
      gaps.push({ atNs: times[i], gapSec: periods[i] });
    }
  }
  let totalBytes = 0;
  for (let i = 0; i < sizes.length; i++) totalBytes += sizes[i];
  const bandwidthBytesPerSec = durationSec > 0 ? totalBytes / durationSec : 0;
  const rateOverTime = computeRateOverTime(times);
  return {
    topic,
    count: n,
    durationSec,
    meanHz,
    medianPeriodSec,
    jitterSec,
    gapCount: gaps.length,
    gaps,
    bandwidthBytesPerSec,
    rateOverTime
  };
}
function computeRateOverTime(times) {
  const n = times.length;
  if (n < 2) return { t: new Float64Array(0), hz: new Float64Array(0) };
  const startNs = times[0];
  const endNs = times[n - 1];
  const totalNs = endNs - startNs;
  const windowNs = totalNs / RATE_WINDOWS;
  if (windowNs <= 0) return { t: new Float64Array(0), hz: new Float64Array(0) };
  const t = new Float64Array(RATE_WINDOWS);
  const hz = new Float64Array(RATE_WINDOWS);
  for (let w = 0; w < RATE_WINDOWS; w++) {
    const wStart = startNs + w * windowNs;
    const wEnd = wStart + windowNs;
    t[w] = (wStart + windowNs / 2) / 1e9;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (times[mid] < wStart) lo = mid + 1;
      else hi = mid;
    }
    const firstIdx = lo;
    lo = 0;
    hi = n;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (times[mid] < wEnd) lo = mid + 1;
      else hi = mid;
    }
    hz[w] = (lo - firstIdx) / (windowNs / 1e9);
  }
  return { t, hz };
}

// cli/check.ts
var UsageError = class extends Error {
};
var TOP_KEYS = ["min_duration_s", "max_duration_s", "allow_extra_topics", "topics"];
var NUMERIC_RULES = ["min_hz", "max_hz", "min_messages", "max_gap_s"];
var RULE_KEYS = ["type", "optional", ...NUMERIC_RULES];
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function number2(v, where) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new UsageError(`${where} must be a non-negative number`);
  }
  return v;
}
function parseExpectations(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`expectations file is not valid JSON: ${e.message}`);
  }
  if (!isObject(raw)) throw new UsageError("expectations file must be a JSON object");
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) throw new UsageError(`unknown key "${k}" (expected one of: ${TOP_KEYS.join(", ")})`);
  }
  const out = {};
  if (raw.min_duration_s !== void 0) out.min_duration_s = number2(raw.min_duration_s, "min_duration_s");
  if (raw.max_duration_s !== void 0) out.max_duration_s = number2(raw.max_duration_s, "max_duration_s");
  if (raw.allow_extra_topics !== void 0) {
    if (typeof raw.allow_extra_topics !== "boolean") throw new UsageError("allow_extra_topics must be true or false");
    out.allow_extra_topics = raw.allow_extra_topics;
  }
  if (raw.topics !== void 0) {
    if (!isObject(raw.topics)) throw new UsageError("topics must be an object keyed by topic name");
    out.topics = {};
    for (const [name, rule] of Object.entries(raw.topics)) {
      if (!isObject(rule)) throw new UsageError(`topics["${name}"] must be an object (use {} to only require the topic)`);
      for (const k of Object.keys(rule)) {
        if (!RULE_KEYS.includes(k)) {
          throw new UsageError(`topics["${name}"]: unknown key "${k}" (expected one of: ${RULE_KEYS.join(", ")})`);
        }
      }
      const r = {};
      if (rule.type !== void 0) {
        if (typeof rule.type !== "string") throw new UsageError(`topics["${name}"].type must be a string`);
        r.type = rule.type;
      }
      if (rule.optional !== void 0) {
        if (typeof rule.optional !== "boolean") throw new UsageError(`topics["${name}"].optional must be true or false`);
        r.optional = rule.optional;
      }
      for (const k of NUMERIC_RULES) {
        if (rule[k] !== void 0) r[k] = number2(rule[k], `topics["${name}"].${k}`);
      }
      out.topics[name] = r;
    }
  }
  return out;
}
function maxGapSeconds(times) {
  let max = 0;
  for (let i = 1; i < times.length; i++) max = Math.max(max, times[i] - times[i - 1]);
  return max / 1e9;
}
function topicRows(summary, stats) {
  return summary.topics.map((t) => {
    const s = stats[t.name];
    const h = s ? computeTopicHealth(t.name, s) : null;
    return {
      topic: t.name,
      type: t.type,
      count: t.messageCount,
      hz: h?.meanHz ?? 0,
      maxGapS: s ? maxGapSeconds(s.times) : 0
    };
  });
}
var f = (n) => n >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "") || "0";
function evaluate(summary, stats, ex) {
  const checks = [];
  const add = (ok, subject, message) => checks.push({ ok, subject, message });
  if (ex.min_duration_s !== void 0) {
    add(summary.duration >= ex.min_duration_s, "bag", `duration ${f(summary.duration)} s, need at least ${f(ex.min_duration_s)} s`);
  }
  if (ex.max_duration_s !== void 0) {
    add(summary.duration <= ex.max_duration_s, "bag", `duration ${f(summary.duration)} s, need at most ${f(ex.max_duration_s)} s`);
  }
  const rows = new Map(topicRows(summary, stats).map((r) => [r.topic, r]));
  const rules = ex.topics ?? {};
  for (const [name, rule] of Object.entries(rules)) {
    const row = rows.get(name);
    if (!row) {
      if (!rule.optional) add(false, name, "topic is missing");
      continue;
    }
    if (rule.type !== void 0) {
      add(normalizeType(row.type) === normalizeType(rule.type), name, `type ${row.type}, expected ${rule.type}`);
    }
    if (rule.min_messages !== void 0) {
      add(row.count >= rule.min_messages, name, `${row.count} messages, need at least ${rule.min_messages}`);
    }
    if (rule.min_hz !== void 0) add(row.hz >= rule.min_hz, name, `${f(row.hz)} Hz, need at least ${f(rule.min_hz)} Hz`);
    if (rule.max_hz !== void 0) add(row.hz <= rule.max_hz, name, `${f(row.hz)} Hz, need at most ${f(rule.max_hz)} Hz`);
    if (rule.max_gap_s !== void 0) {
      add(row.maxGapS <= rule.max_gap_s, name, `longest gap ${f(row.maxGapS)} s, allowed ${f(rule.max_gap_s)} s`);
    }
    if (Object.keys(rule).every((k) => k === "optional")) add(true, name, "present");
  }
  if (ex.allow_extra_topics === false) {
    for (const name of rows.keys()) if (!(name in rules)) add(false, name, "unexpected topic");
  }
  return checks;
}
var passed = (r) => r.checks.every((c) => c.ok);
function formatText(reports) {
  const out = [];
  for (const r of reports) {
    out.push(`${passed(r) ? "PASS" : "FAIL"}  ${r.name}  (${f(r.summary.duration)} s, ${r.summary.totalMessageCount} messages, ${r.summary.topics.length} topics)`);
    const w = Math.max(5, ...r.rows.map((x) => x.topic.length));
    for (const x of r.rows) out.push(`  ${x.topic.padEnd(w)}  ${String(x.count).padStart(8)}  ${f(x.hz).padStart(8)} Hz  gap ${f(x.maxGapS)} s  ${x.type}`);
    for (const c of r.checks.filter((c2) => !c2.ok)) out.push(`  x ${c.subject}: ${c.message}`);
  }
  return `${out.join("\n")}
`;
}
function formatMarkdown(reports) {
  const out = ["## Bag check", ""];
  for (const r of reports) {
    out.push(`### ${passed(r) ? "PASS" : "FAIL"}: \`${r.name}\``, "");
    out.push(`${f(r.summary.duration)} s, ${r.summary.totalMessageCount} messages, ${r.summary.topics.length} topics`, "");
    const failed = r.checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      for (const c of failed) out.push(`- \`${c.subject}\`: ${c.message}`);
      out.push("");
    }
    out.push("| Topic | Type | Messages | Hz | Longest gap (s) |", "| --- | --- | ---: | ---: | ---: |");
    for (const x of r.rows) out.push(`| \`${x.topic}\` | \`${x.type}\` | ${x.count} | ${f(x.hz)} | ${f(x.maxGapS)} |`);
    out.push("");
  }
  return `${out.join("\n")}
`;
}

// cli/main.ts
var USAGE = "usage: bagel-check [--expect rules.json] [--json] [--summary file.md] <bag-or-folder>...";
function parseArgs(argv) {
  const args = { json: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === void 0) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--expect") args.expect = value();
    else if (a === "--summary") args.summary = value();
    else if (a === "--json") args.json = true;
    else if (a.startsWith("--")) throw new UsageError(`unknown option ${a}`);
    else args.paths.push(a);
  }
  if (args.paths.length === 0) throw new UsageError("no bag file or folder given");
  return args;
}
function collect(paths) {
  const out = [];
  for (const p of paths) {
    let st;
    try {
      st = statSync(p);
    } catch {
      throw new UsageError(`cannot read ${p}`);
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        const path = join(p, name);
        if (statSync(path).isFile()) out.push({ name, dir: p, path });
      }
    } else out.push({ name: basename(p), dir: join(p, ".."), path: p });
  }
  return out;
}
async function toSource(files, displayName) {
  const parts = [];
  for (const f2 of files) {
    parts.push({ kind: "file", file: new File([await openAsBlob(f2.path)], f2.name) });
  }
  return parts.length === 1 ? parts[0] : { kind: "multi", parts, displayName };
}
async function run(argv, io) {
  try {
    const args = parseArgs(argv);
    let expectations = null;
    if (args.expect) {
      let text;
      try {
        text = readFileSync(args.expect, "utf8");
      } catch {
        throw new UsageError(`cannot read ${args.expect}`);
      }
      expectations = parseExpectations(text);
    }
    const files = collect(args.paths);
    const meta = files.find((f2) => f2.name === "metadata.yaml");
    const groups = groupBagFiles(files, meta ? readFileSync(meta.path, "utf8") : void 0);
    if (groups.length === 0) throw new UsageError("no .mcap, .db3 or .bag files found");
    const reports = [];
    for (const g of groups) {
      const source = await toSource(g.files, g.displayName);
      let summary;
      try {
        summary = await parseBag(source);
      } catch (e) {
        throw new UsageError(`${g.displayName}: ${e.message}`);
      }
      const stats = await readAllMessageStats(source, summary.format);
      reports.push({
        name: g.displayName,
        summary,
        rows: topicRows(summary, stats),
        checks: expectations ? evaluate(summary, stats, expectations) : []
      });
    }
    io.out(
      args.json ? `${JSON.stringify(reports.map((r) => ({ name: r.name, passed: passed(r), duration_s: r.summary.duration, topics: r.rows, checks: r.checks })), null, 2)}
` : formatText(reports)
    );
    const md = formatMarkdown(reports);
    if (args.summary) writeFileSync(args.summary, md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    return reports.every(passed) ? 0 : 1;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`bagel-check: ${e.message}
${USAGE}
`);
    return 2;
  }
}

// cli/bin.ts
process.exitCode = await run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s)
});
