// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/qrcode-terminal/vendor/QRCode/QRMode.js
var require_QRMode = __commonJS((exports, module) => {
  module.exports = {
    MODE_NUMBER: 1 << 0,
    MODE_ALPHA_NUM: 1 << 1,
    MODE_8BIT_BYTE: 1 << 2,
    MODE_KANJI: 1 << 3
  };
});

// node_modules/qrcode-terminal/vendor/QRCode/QR8bitByte.js
var require_QR8bitByte = __commonJS((exports, module) => {
  var QRMode = require_QRMode();
  function QR8bitByte(data) {
    this.mode = QRMode.MODE_8BIT_BYTE;
    this.data = data;
  }
  QR8bitByte.prototype = {
    getLength: function() {
      return this.data.length;
    },
    write: function(buffer) {
      for (var i = 0;i < this.data.length; i++) {
        buffer.put(this.data.charCodeAt(i), 8);
      }
    }
  };
  module.exports = QR8bitByte;
});

// node_modules/qrcode-terminal/vendor/QRCode/QRMath.js
var require_QRMath = __commonJS((exports, module) => {
  var QRMath = {
    glog: function(n) {
      if (n < 1) {
        throw new Error("glog(" + n + ")");
      }
      return QRMath.LOG_TABLE[n];
    },
    gexp: function(n) {
      while (n < 0) {
        n += 255;
      }
      while (n >= 256) {
        n -= 255;
      }
      return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256)
  };
  for (i = 0;i < 8; i++) {
    QRMath.EXP_TABLE[i] = 1 << i;
  }
  var i;
  for (i = 8;i < 256; i++) {
    QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
  }
  var i;
  for (i = 0;i < 255; i++) {
    QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
  }
  var i;
  module.exports = QRMath;
});

// node_modules/qrcode-terminal/vendor/QRCode/QRPolynomial.js
var require_QRPolynomial = __commonJS((exports, module) => {
  var QRMath = require_QRMath();
  function QRPolynomial(num, shift) {
    if (num.length === undefined) {
      throw new Error(num.length + "/" + shift);
    }
    var offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset++;
    }
    this.num = new Array(num.length - offset + shift);
    for (var i = 0;i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
  }
  QRPolynomial.prototype = {
    get: function(index) {
      return this.num[index];
    },
    getLength: function() {
      return this.num.length;
    },
    multiply: function(e) {
      var num = new Array(this.getLength() + e.getLength() - 1);
      for (var i = 0;i < this.getLength(); i++) {
        for (var j = 0;j < e.getLength(); j++) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function(e) {
      if (this.getLength() - e.getLength() < 0) {
        return this;
      }
      var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      var num = new Array(this.getLength());
      for (var i = 0;i < this.getLength(); i++) {
        num[i] = this.get(i);
      }
      for (var x = 0;x < e.getLength(); x++) {
        num[x] ^= QRMath.gexp(QRMath.glog(e.get(x)) + ratio);
      }
      return new QRPolynomial(num, 0).mod(e);
    }
  };
  module.exports = QRPolynomial;
});

// node_modules/qrcode-terminal/vendor/QRCode/QRMaskPattern.js
var require_QRMaskPattern = __commonJS((exports, module) => {
  module.exports = {
    PATTERN000: 0,
    PATTERN001: 1,
    PATTERN010: 2,
    PATTERN011: 3,
    PATTERN100: 4,
    PATTERN101: 5,
    PATTERN110: 6,
    PATTERN111: 7
  };
});

// node_modules/qrcode-terminal/vendor/QRCode/QRUtil.js
var require_QRUtil = __commonJS((exports, module) => {
  var QRMode = require_QRMode();
  var QRPolynomial = require_QRPolynomial();
  var QRMath = require_QRMath();
  var QRMaskPattern = require_QRMaskPattern();
  var QRUtil = {
    PATTERN_POSITION_TABLE: [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ],
    G15: 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0,
    G18: 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0,
    G15_MASK: 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1,
    getBCHTypeInfo: function(data) {
      var d = data << 10;
      while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
        d ^= QRUtil.G15 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15);
      }
      return (data << 10 | d) ^ QRUtil.G15_MASK;
    },
    getBCHTypeNumber: function(data) {
      var d = data << 12;
      while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
        d ^= QRUtil.G18 << QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18);
      }
      return data << 12 | d;
    },
    getBCHDigit: function(data) {
      var digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    },
    getPatternPosition: function(typeNumber) {
      return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },
    getMask: function(maskPattern, i, j) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000:
          return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001:
          return i % 2 === 0;
        case QRMaskPattern.PATTERN010:
          return j % 3 === 0;
        case QRMaskPattern.PATTERN011:
          return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case QRMaskPattern.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case QRMaskPattern.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    },
    getErrorCorrectPolynomial: function(errorCorrectLength) {
      var a = new QRPolynomial([1], 0);
      for (var i = 0;i < errorCorrectLength; i++) {
        a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    },
    getLengthInBits: function(mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 10;
          case QRMode.MODE_ALPHA_NUM:
            return 9;
          case QRMode.MODE_8BIT_BYTE:
            return 8;
          case QRMode.MODE_KANJI:
            return 8;
          default:
            throw new Error("mode:" + mode);
        }
      } else if (type < 27) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 12;
          case QRMode.MODE_ALPHA_NUM:
            return 11;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 10;
          default:
            throw new Error("mode:" + mode);
        }
      } else if (type < 41) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 14;
          case QRMode.MODE_ALPHA_NUM:
            return 13;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 12;
          default:
            throw new Error("mode:" + mode);
        }
      } else {
        throw new Error("type:" + type);
      }
    },
    getLostPoint: function(qrCode) {
      var moduleCount = qrCode.getModuleCount();
      var lostPoint = 0;
      var row = 0;
      var col = 0;
      for (row = 0;row < moduleCount; row++) {
        for (col = 0;col < moduleCount; col++) {
          var sameCount = 0;
          var dark = qrCode.isDark(row, col);
          for (var r = -1;r <= 1; r++) {
            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }
            for (var c = -1;c <= 1; c++) {
              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }
              if (r === 0 && c === 0) {
                continue;
              }
              if (dark === qrCode.isDark(row + r, col + c)) {
                sameCount++;
              }
            }
          }
          if (sameCount > 5) {
            lostPoint += 3 + sameCount - 5;
          }
        }
      }
      for (row = 0;row < moduleCount - 1; row++) {
        for (col = 0;col < moduleCount - 1; col++) {
          var count = 0;
          if (qrCode.isDark(row, col))
            count++;
          if (qrCode.isDark(row + 1, col))
            count++;
          if (qrCode.isDark(row, col + 1))
            count++;
          if (qrCode.isDark(row + 1, col + 1))
            count++;
          if (count === 0 || count === 4) {
            lostPoint += 3;
          }
        }
      }
      for (row = 0;row < moduleCount; row++) {
        for (col = 0;col < moduleCount - 6; col++) {
          if (qrCode.isDark(row, col) && !qrCode.isDark(row, col + 1) && qrCode.isDark(row, col + 2) && qrCode.isDark(row, col + 3) && qrCode.isDark(row, col + 4) && !qrCode.isDark(row, col + 5) && qrCode.isDark(row, col + 6)) {
            lostPoint += 40;
          }
        }
      }
      for (col = 0;col < moduleCount; col++) {
        for (row = 0;row < moduleCount - 6; row++) {
          if (qrCode.isDark(row, col) && !qrCode.isDark(row + 1, col) && qrCode.isDark(row + 2, col) && qrCode.isDark(row + 3, col) && qrCode.isDark(row + 4, col) && !qrCode.isDark(row + 5, col) && qrCode.isDark(row + 6, col)) {
            lostPoint += 40;
          }
        }
      }
      var darkCount = 0;
      for (col = 0;col < moduleCount; col++) {
        for (row = 0;row < moduleCount; row++) {
          if (qrCode.isDark(row, col)) {
            darkCount++;
          }
        }
      }
      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    }
  };
  module.exports = QRUtil;
});

// node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js
var require_QRErrorCorrectLevel = __commonJS((exports, module) => {
  module.exports = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2
  };
});

// node_modules/qrcode-terminal/vendor/QRCode/QRRSBlock.js
var require_QRRSBlock = __commonJS((exports, module) => {
  var QRErrorCorrectLevel = require_QRErrorCorrectLevel();
  function QRRSBlock(totalCount, dataCount) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }
  QRRSBlock.RS_BLOCK_TABLE = [
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12],
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
    var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
    if (rsBlock === undefined) {
      throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
    }
    var length = rsBlock.length / 3;
    var list = [];
    for (var i = 0;i < length; i++) {
      var count = rsBlock[i * 3 + 0];
      var totalCount = rsBlock[i * 3 + 1];
      var dataCount = rsBlock[i * 3 + 2];
      for (var j = 0;j < count; j++) {
        list.push(new QRRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {
    switch (errorCorrectLevel) {
      case QRErrorCorrectLevel.L:
        return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectLevel.M:
        return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectLevel.Q:
        return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectLevel.H:
        return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return;
    }
  };
  module.exports = QRRSBlock;
});

// node_modules/qrcode-terminal/vendor/QRCode/QRBitBuffer.js
var require_QRBitBuffer = __commonJS((exports, module) => {
  function QRBitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  QRBitBuffer.prototype = {
    get: function(index) {
      var bufIndex = Math.floor(index / 8);
      return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
    },
    put: function(num, length) {
      for (var i = 0;i < length; i++) {
        this.putBit((num >>> length - i - 1 & 1) == 1);
      }
    },
    getLengthInBits: function() {
      return this.length;
    },
    putBit: function(bit) {
      var bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) {
        this.buffer.push(0);
      }
      if (bit) {
        this.buffer[bufIndex] |= 128 >>> this.length % 8;
      }
      this.length++;
    }
  };
  module.exports = QRBitBuffer;
});

// node_modules/qrcode-terminal/vendor/QRCode/index.js
var require_QRCode = __commonJS((exports, module) => {
  var QR8bitByte = require_QR8bitByte();
  var QRUtil = require_QRUtil();
  var QRPolynomial = require_QRPolynomial();
  var QRRSBlock = require_QRRSBlock();
  var QRBitBuffer = require_QRBitBuffer();
  function QRCode(typeNumber, errorCorrectLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }
  QRCode.prototype = {
    addData: function(data) {
      var newData = new QR8bitByte(data);
      this.dataList.push(newData);
      this.dataCache = null;
    },
    isDark: function(row, col) {
      if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
        throw new Error(row + "," + col);
      }
      return this.modules[row][col];
    },
    getModuleCount: function() {
      return this.moduleCount;
    },
    make: function() {
      if (this.typeNumber < 1) {
        var typeNumber = 1;
        for (typeNumber = 1;typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);
          var buffer = new QRBitBuffer;
          var totalDataCount = 0;
          for (var i = 0;i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }
          for (var x = 0;x < this.dataList.length; x++) {
            var data = this.dataList[x];
            buffer.put(data.mode, 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
            data.write(buffer);
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8)
            break;
        }
        this.typeNumber = typeNumber;
      }
      this.makeImpl(false, this.getBestMaskPattern());
    },
    makeImpl: function(test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (var row = 0;row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount);
        for (var col = 0;col < this.moduleCount; col++) {
          this.modules[row][col] = null;
        }
      }
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      if (this.typeNumber >= 7) {
        this.setupTypeNumber(test);
      }
      if (this.dataCache === null) {
        this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
      }
      this.mapData(this.dataCache, maskPattern);
    },
    setupPositionProbePattern: function(row, col) {
      for (var r = -1;r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r)
          continue;
        for (var c = -1;c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c)
            continue;
          if (0 <= r && r <= 6 && (c === 0 || c === 6) || 0 <= c && c <= 6 && (r === 0 || r === 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
            this.modules[row + r][col + c] = true;
          } else {
            this.modules[row + r][col + c] = false;
          }
        }
      }
    },
    getBestMaskPattern: function() {
      var minLostPoint = 0;
      var pattern = 0;
      for (var i = 0;i < 8; i++) {
        this.makeImpl(true, i);
        var lostPoint = QRUtil.getLostPoint(this);
        if (i === 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }
      return pattern;
    },
    createMovieClip: function(target_mc, instance_name, depth) {
      var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
      var cs = 1;
      this.make();
      for (var row = 0;row < this.modules.length; row++) {
        var y = row * cs;
        for (var col = 0;col < this.modules[row].length; col++) {
          var x = col * cs;
          var dark = this.modules[row][col];
          if (dark) {
            qr_mc.beginFill(0, 100);
            qr_mc.moveTo(x, y);
            qr_mc.lineTo(x + cs, y);
            qr_mc.lineTo(x + cs, y + cs);
            qr_mc.lineTo(x, y + cs);
            qr_mc.endFill();
          }
        }
      }
      return qr_mc;
    },
    setupTimingPattern: function() {
      for (var r = 8;r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] !== null) {
          continue;
        }
        this.modules[r][6] = r % 2 === 0;
      }
      for (var c = 8;c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] !== null) {
          continue;
        }
        this.modules[6][c] = c % 2 === 0;
      }
    },
    setupPositionAdjustPattern: function() {
      var pos = QRUtil.getPatternPosition(this.typeNumber);
      for (var i = 0;i < pos.length; i++) {
        for (var j = 0;j < pos.length; j++) {
          var row = pos[i];
          var col = pos[j];
          if (this.modules[row][col] !== null) {
            continue;
          }
          for (var r = -2;r <= 2; r++) {
            for (var c = -2;c <= 2; c++) {
              if (Math.abs(r) === 2 || Math.abs(c) === 2 || r === 0 && c === 0) {
                this.modules[row + r][col + c] = true;
              } else {
                this.modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    },
    setupTypeNumber: function(test) {
      var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
      var mod;
      for (var i = 0;i < 18; i++) {
        mod = !test && (bits >> i & 1) === 1;
        this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
      }
      for (var x = 0;x < 18; x++) {
        mod = !test && (bits >> x & 1) === 1;
        this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
      }
    },
    setupTypeInfo: function(test, maskPattern) {
      var data = this.errorCorrectLevel << 3 | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);
      var mod;
      for (var v = 0;v < 15; v++) {
        mod = !test && (bits >> v & 1) === 1;
        if (v < 6) {
          this.modules[v][8] = mod;
        } else if (v < 8) {
          this.modules[v + 1][8] = mod;
        } else {
          this.modules[this.moduleCount - 15 + v][8] = mod;
        }
      }
      for (var h = 0;h < 15; h++) {
        mod = !test && (bits >> h & 1) === 1;
        if (h < 8) {
          this.modules[8][this.moduleCount - h - 1] = mod;
        } else if (h < 9) {
          this.modules[8][15 - h - 1 + 1] = mod;
        } else {
          this.modules[8][15 - h - 1] = mod;
        }
      }
      this.modules[this.moduleCount - 8][8] = !test;
    },
    mapData: function(data, maskPattern) {
      var inc = -1;
      var row = this.moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      for (var col = this.moduleCount - 1;col > 0; col -= 2) {
        if (col === 6)
          col--;
        while (true) {
          for (var c = 0;c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              var dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              var mask = QRUtil.getMask(maskPattern, row, col - c);
              if (mask) {
                dark = !dark;
              }
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
  };
  QRCode.PAD0 = 236;
  QRCode.PAD1 = 17;
  QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
    var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    var buffer = new QRBitBuffer;
    for (var i = 0;i < dataList.length; i++) {
      var data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }
    var totalDataCount = 0;
    for (var x = 0;x < rsBlocks.length; x++) {
      totalDataCount += rsBlocks[x].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")");
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 !== 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(QRCode.PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(QRCode.PAD1, 8);
    }
    return QRCode.createBytes(buffer, rsBlocks);
  };
  QRCode.createBytes = function(buffer, rsBlocks) {
    var offset = 0;
    var maxDcCount = 0;
    var maxEcCount = 0;
    var dcdata = new Array(rsBlocks.length);
    var ecdata = new Array(rsBlocks.length);
    for (var r = 0;r < rsBlocks.length; r++) {
      var dcCount = rsBlocks[r].dataCount;
      var ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (var i = 0;i < dcdata[r].length; i++) {
        dcdata[r][i] = 255 & buffer.buffer[i + offset];
      }
      offset += dcCount;
      var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      var modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (var x = 0;x < ecdata[r].length; x++) {
        var modIndex = x + modPoly.getLength() - ecdata[r].length;
        ecdata[r][x] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
      }
    }
    var totalCodeCount = 0;
    for (var y = 0;y < rsBlocks.length; y++) {
      totalCodeCount += rsBlocks[y].totalCount;
    }
    var data = new Array(totalCodeCount);
    var index = 0;
    for (var z = 0;z < maxDcCount; z++) {
      for (var s = 0;s < rsBlocks.length; s++) {
        if (z < dcdata[s].length) {
          data[index++] = dcdata[s][z];
        }
      }
    }
    for (var xx = 0;xx < maxEcCount; xx++) {
      for (var t = 0;t < rsBlocks.length; t++) {
        if (xx < ecdata[t].length) {
          data[index++] = ecdata[t][xx];
        }
      }
    }
    return data;
  };
  module.exports = QRCode;
});

// node_modules/qrcode-terminal/lib/main.js
var require_main = __commonJS((exports, module) => {
  var QRCode = require_QRCode();
  var QRErrorCorrectLevel = require_QRErrorCorrectLevel();
  var black = "\x1B[40m  \x1B[0m";
  var white = "\x1B[47m  \x1B[0m";
  var toCell = function(isBlack) {
    return isBlack ? black : white;
  };
  var repeat = function(color) {
    return {
      times: function(count) {
        return new Array(count).join(color);
      }
    };
  };
  var fill = function(length, value) {
    var arr = new Array(length);
    for (var i = 0;i < length; i++) {
      arr[i] = value;
    }
    return arr;
  };
  module.exports = {
    error: QRErrorCorrectLevel.L,
    generate: function(input, opts, cb) {
      if (typeof opts === "function") {
        cb = opts;
        opts = {};
      }
      var qrcode = new QRCode(-1, this.error);
      qrcode.addData(input);
      qrcode.make();
      var output = "";
      if (opts && opts.small) {
        var BLACK = true, WHITE = false;
        var moduleCount = qrcode.getModuleCount();
        var moduleData = qrcode.modules.slice();
        var oddRow = moduleCount % 2 === 1;
        if (oddRow) {
          moduleData.push(fill(moduleCount, WHITE));
        }
        var platte = {
          WHITE_ALL: "\u2588",
          WHITE_BLACK: "\u2580",
          BLACK_WHITE: "\u2584",
          BLACK_ALL: " "
        };
        var borderTop = repeat(platte.BLACK_WHITE).times(moduleCount + 3);
        var borderBottom = repeat(platte.WHITE_BLACK).times(moduleCount + 3);
        output += borderTop + `
`;
        for (var row = 0;row < moduleCount; row += 2) {
          output += platte.WHITE_ALL;
          for (var col = 0;col < moduleCount; col++) {
            if (moduleData[row][col] === WHITE && moduleData[row + 1][col] === WHITE) {
              output += platte.WHITE_ALL;
            } else if (moduleData[row][col] === WHITE && moduleData[row + 1][col] === BLACK) {
              output += platte.WHITE_BLACK;
            } else if (moduleData[row][col] === BLACK && moduleData[row + 1][col] === WHITE) {
              output += platte.BLACK_WHITE;
            } else {
              output += platte.BLACK_ALL;
            }
          }
          output += platte.WHITE_ALL + `
`;
        }
        if (!oddRow) {
          output += borderBottom;
        }
      } else {
        var border = repeat(white).times(qrcode.getModuleCount() + 3);
        output += border + `
`;
        qrcode.modules.forEach(function(row2) {
          output += white;
          output += row2.map(toCell).join("");
          output += white + `
`;
        });
        output += border;
      }
      if (cb)
        cb(output);
      else
        console.log(output);
    },
    setErrorLevel: function(error) {
      this.error = QRErrorCorrectLevel[error] || this.error;
    }
  };
});

// src/qr.ts
var import_qrcode_terminal = __toESM(require_main(), 1);
function displayQRCode(info) {
  const data = JSON.stringify({
    l: info.localIP,
    t: info.tailscaleIP,
    p: info.port,
    v: info.version
  });
  console.log(`
`);
  console.log("  Scan this QR code with the Broski app:");
  console.log("");
  import_qrcode_terminal.default.generate(data, { small: true }, (qr) => {
    const indented = qr.split(`
`).map((line) => `    ${line}`).join(`
`);
    console.log(indented);
  });
  console.log("");
  console.log("  Or connect manually:");
  if (info.localIP) {
    console.log(`  - Local:     ws://${info.localIP}:${info.port}`);
  }
  if (info.tailscaleIP) {
    console.log(`  - Tailscale: ws://${info.tailscaleIP}:${info.port}`);
  }
  console.log("");
}
function displayBanner() {
  console.log(`
  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
  \u2551                                                          \u2551
  \u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557           \u2551
  \u2551   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2551 \u2588\u2588\u2554\u255D\u2588\u2588\u2551           \u2551
  \u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551           \u2551
  \u2551   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2588\u2588\u2557 \u2588\u2588\u2551           \u2551
  \u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2557\u2588\u2588\u2551           \u2551
  \u2551   \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D           \u2551
  \u2551                                                          \u2551
  \u2551                Broski Bridge (Personal MVP)              \u2551
  \u2551                                                          \u2551
  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
  `);
}

// src/network.ts
import { networkInterfaces } from "os";
var {$ } = globalThis.Bun;
function getLocalIP() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.internal || iface.family !== "IPv4")
        continue;
      if (name === "en0" || name === "eth0")
        return iface.address;
    }
  }
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return null;
}
async function getTailscaleIP() {
  try {
    const result = await $`tailscale ip -4 2>/dev/null`.quiet();
    const ip = result.text().trim();
    if (ip.startsWith("100."))
      return ip;
    return null;
  } catch {
    return null;
  }
}
async function isTailscaleConnected() {
  try {
    const result = await $`tailscale status 2>/dev/null`.quiet();
    return !result.text().includes("Tailscale is stopped");
  } catch {
    return false;
  }
}
// node_modules/@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js
var createSseClient = ({ onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }) => {
  let lastEventId;
  const sleep = sseSleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3000;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== undefined) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const response = await fetch(url, { ...options, headers, signal });
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {}
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            const chunks = buffer.split(`

`);
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split(`
`);
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join(`
`);
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 30000);
        await sleep(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
};

// node_modules/@opencode-ai/sdk/dist/gen/core/auth.gen.js
var getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/bodySerializer.gen.js
var jsonBodySerializer = {
  bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
};

// node_modules/@opencode-ai/sdk/dist/gen/core/pathSerializer.gen.js
var separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
};
var separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var serializeArrayParam = ({ allowReserved, explode, name, style, value }) => {
  if (!explode) {
    const joinedValues2 = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      case "simple":
        return joinedValues2;
      default:
        return `${name}=${joinedValues2}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
var serializePrimitiveParam = ({ allowReserved, name, value }) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren\u2019t supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
var serializeObjectParam = ({ allowReserved, explode, name, style, value, valueOnly }) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues2 = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues2}`;
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      default:
        return joinedValues2;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/utils.gen.js
var PATH_PARAM_RE = /\{[^{}]+\}/g;
var defaultPathSerializer = ({ path, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path[name];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
};
var getUrl = ({ baseUrl, path, query, querySerializer, url: _url }) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path) {
    url = defaultPathSerializer({ path, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};

// node_modules/@opencode-ai/sdk/dist/gen/client/utils.gen.js
var createQuerySerializer = ({ allowReserved, array, object } = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...array
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...object
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
};
var getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
};
var checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
};
var setAuthParams = async ({ security, ...options }) => {
  for (const auth of security) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
};
var buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
});
var mergeConfigs = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
};
var mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers;
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }
    const iterator = header instanceof Headers ? header.entries() : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== undefined) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
};

class Interceptors {
  _fns;
  constructor() {
    this._fns = [];
  }
  clear() {
    this._fns = [];
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this._fns[id] ? id : -1;
    } else {
      return this._fns.indexOf(id);
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return !!this._fns[index];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = null;
    }
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = fn;
      return id;
    } else {
      return false;
    }
  }
  use(fn) {
    this._fns = [...this._fns, fn];
    return this._fns.length - 1;
  }
}
var createInterceptors = () => ({
  error: new Interceptors,
  request: new Interceptors,
  response: new Interceptors
});
var defaultQuerySerializer = createQuerySerializer({
  allowReserved: false,
  array: {
    explode: true,
    style: "form"
  },
  object: {
    explode: true,
    style: "deepObject"
  }
});
var defaultHeaders = {
  "Content-Type": "application/json"
};
var createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});

// node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js
var createClient = (config = {}) => {
  let _config = mergeConfigs(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config2) => {
    _config = mergeConfigs(_config, config2);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: undefined
    };
    if (opts.security) {
      await setAuthParams({
        ...opts,
        security: opts.security
      });
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.serializedBody === undefined || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const url = buildUrl(opts);
    return { opts, url };
  };
  const request = async (options) => {
    const { opts, url } = await beforeRequest(options);
    const requestInit = {
      redirect: "follow",
      ...opts,
      body: opts.serializedBody
    };
    let request2 = new Request(url, requestInit);
    for (const fn of interceptors.request._fns) {
      if (fn) {
        request2 = await fn(request2, opts);
      }
    }
    const _fetch = opts.fetch;
    let response = await _fetch(request2);
    for (const fn of interceptors.response._fns) {
      if (fn) {
        response = await fn(response, request2, opts);
      }
    }
    const result = {
      request: request2,
      response
    };
    if (response.ok) {
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return opts.responseStyle === "data" ? {} : {
          data: {},
          ...result
        };
      }
      const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
      let data;
      switch (parseAs) {
        case "arrayBuffer":
        case "blob":
        case "formData":
        case "json":
        case "text":
          data = await response[parseAs]();
          break;
        case "stream":
          return opts.responseStyle === "data" ? response.body : {
            data: response.body,
            ...result
          };
      }
      if (parseAs === "json") {
        if (opts.responseValidator) {
          await opts.responseValidator(data);
        }
        if (opts.responseTransformer) {
          data = await opts.responseTransformer(data);
        }
      }
      return opts.responseStyle === "data" ? data : {
        data,
        ...result
      };
    }
    const textError = await response.text();
    let jsonError;
    try {
      jsonError = JSON.parse(textError);
    } catch {}
    const error = jsonError ?? textError;
    let finalError = error;
    for (const fn of interceptors.error._fns) {
      if (fn) {
        finalError = await fn(error, response, request2, opts);
      }
    }
    finalError = finalError || {};
    if (opts.throwOnError) {
      throw finalError;
    }
    return opts.responseStyle === "data" ? undefined : {
      error: finalError,
      ...result
    };
  };
  const makeMethod = (method) => {
    const fn = (options) => request({ ...options, method });
    fn.sse = async (options) => {
      const { opts, url } = await beforeRequest(options);
      return createSseClient({
        ...opts,
        body: opts.body,
        headers: opts.headers,
        method,
        url
      });
    };
    return fn;
  };
  return {
    buildUrl,
    connect: makeMethod("CONNECT"),
    delete: makeMethod("DELETE"),
    get: makeMethod("GET"),
    getConfig,
    head: makeMethod("HEAD"),
    interceptors,
    options: makeMethod("OPTIONS"),
    patch: makeMethod("PATCH"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    request,
    setConfig,
    trace: makeMethod("TRACE")
  };
};
// node_modules/@opencode-ai/sdk/dist/gen/core/params.gen.js
var extraPrefixesMap = {
  $body_: "body",
  $headers_: "headers",
  $path_: "path",
  $query_: "query"
};
var extraPrefixes = Object.entries(extraPrefixesMap);
// node_modules/@opencode-ai/sdk/dist/gen/client.gen.js
var client = createClient(createConfig({
  baseUrl: "http://localhost:4096"
}));

// node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js
class _HeyApiClient {
  _client = client;
  constructor(args) {
    if (args?.client) {
      this._client = args.client;
    }
  }
}

class Global extends _HeyApiClient {
  event(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/global/event",
      ...options
    });
  }
}

class Project extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/project",
      ...options
    });
  }
  current(options) {
    return (options?.client ?? this._client).get({
      url: "/project/current",
      ...options
    });
  }
}

class Pty extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/pty",
      ...options
    });
  }
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/pty",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/pty/{id}",
      ...options
    });
  }
  get(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}",
      ...options
    });
  }
  update(options) {
    return (options.client ?? this._client).put({
      url: "/pty/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  connect(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}/connect",
      ...options
    });
  }
}

class Config extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/config",
      ...options
    });
  }
  update(options) {
    return (options?.client ?? this._client).patch({
      url: "/config",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  providers(options) {
    return (options?.client ?? this._client).get({
      url: "/config/providers",
      ...options
    });
  }
}

class Tool extends _HeyApiClient {
  ids(options) {
    return (options?.client ?? this._client).get({
      url: "/experimental/tool/ids",
      ...options
    });
  }
  list(options) {
    return (options.client ?? this._client).get({
      url: "/experimental/tool",
      ...options
    });
  }
}

class Instance extends _HeyApiClient {
  dispose(options) {
    return (options?.client ?? this._client).post({
      url: "/instance/dispose",
      ...options
    });
  }
}

class Path extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/path",
      ...options
    });
  }
}

class Vcs extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/vcs",
      ...options
    });
  }
}

class Session extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/session",
      ...options
    });
  }
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/session",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/session/status",
      ...options
    });
  }
  delete(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}",
      ...options
    });
  }
  get(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}",
      ...options
    });
  }
  update(options) {
    return (options.client ?? this._client).patch({
      url: "/session/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  children(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/children",
      ...options
    });
  }
  todo(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/todo",
      ...options
    });
  }
  init(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/init",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  fork(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/fork",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  abort(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/abort",
      ...options
    });
  }
  unshare(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}/share",
      ...options
    });
  }
  share(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/share",
      ...options
    });
  }
  diff(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/diff",
      ...options
    });
  }
  summarize(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/summarize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  messages(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message",
      ...options
    });
  }
  prompt(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/message",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  message(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message/{messageID}",
      ...options
    });
  }
  promptAsync(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/prompt_async",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  command(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  shell(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/shell",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  revert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/revert",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  unrevert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/unrevert",
      ...options
    });
  }
}

class Command extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/command",
      ...options
    });
  }
}

class Oauth extends _HeyApiClient {
  authorize(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/authorize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
}

class Provider extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/provider",
      ...options
    });
  }
  auth(options) {
    return (options?.client ?? this._client).get({
      url: "/provider/auth",
      ...options
    });
  }
  oauth = new Oauth({ client: this._client });
}

class Find extends _HeyApiClient {
  text(options) {
    return (options.client ?? this._client).get({
      url: "/find",
      ...options
    });
  }
  files(options) {
    return (options.client ?? this._client).get({
      url: "/find/file",
      ...options
    });
  }
  symbols(options) {
    return (options.client ?? this._client).get({
      url: "/find/symbol",
      ...options
    });
  }
}

class File extends _HeyApiClient {
  list(options) {
    return (options.client ?? this._client).get({
      url: "/file",
      ...options
    });
  }
  read(options) {
    return (options.client ?? this._client).get({
      url: "/file/content",
      ...options
    });
  }
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/file/status",
      ...options
    });
  }
}

class App extends _HeyApiClient {
  log(options) {
    return (options?.client ?? this._client).post({
      url: "/log",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  agents(options) {
    return (options?.client ?? this._client).get({
      url: "/agent",
      ...options
    });
  }
}

class Auth extends _HeyApiClient {
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  start(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  authenticate(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/authenticate",
      ...options
    });
  }
  set(options) {
    return (options.client ?? this._client).put({
      url: "/auth/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
}

class Mcp extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/mcp",
      ...options
    });
  }
  add(options) {
    return (options?.client ?? this._client).post({
      url: "/mcp",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  connect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/connect",
      ...options
    });
  }
  disconnect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/disconnect",
      ...options
    });
  }
  auth = new Auth({ client: this._client });
}

class Lsp extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/lsp",
      ...options
    });
  }
}

class Formatter extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/formatter",
      ...options
    });
  }
}

class Control extends _HeyApiClient {
  next(options) {
    return (options?.client ?? this._client).get({
      url: "/tui/control/next",
      ...options
    });
  }
  response(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/control/response",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
}

class Tui extends _HeyApiClient {
  appendPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/append-prompt",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  openHelp(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-help",
      ...options
    });
  }
  openSessions(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-sessions",
      ...options
    });
  }
  openThemes(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-themes",
      ...options
    });
  }
  openModels(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-models",
      ...options
    });
  }
  submitPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/submit-prompt",
      ...options
    });
  }
  clearPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/clear-prompt",
      ...options
    });
  }
  executeCommand(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/execute-command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  showToast(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/show-toast",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  publish(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/publish",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  control = new Control({ client: this._client });
}

class Event extends _HeyApiClient {
  subscribe(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/event",
      ...options
    });
  }
}

class OpencodeClient extends _HeyApiClient {
  postSessionIdPermissionsPermissionId(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/permissions/{permissionID}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  global = new Global({ client: this._client });
  project = new Project({ client: this._client });
  pty = new Pty({ client: this._client });
  config = new Config({ client: this._client });
  tool = new Tool({ client: this._client });
  instance = new Instance({ client: this._client });
  path = new Path({ client: this._client });
  vcs = new Vcs({ client: this._client });
  session = new Session({ client: this._client });
  command = new Command({ client: this._client });
  provider = new Provider({ client: this._client });
  find = new Find({ client: this._client });
  file = new File({ client: this._client });
  app = new App({ client: this._client });
  mcp = new Mcp({ client: this._client });
  lsp = new Lsp({ client: this._client });
  formatter = new Formatter({ client: this._client });
  tui = new Tui({ client: this._client });
  auth = new Auth({ client: this._client });
  event = new Event({ client: this._client });
}

// node_modules/@opencode-ai/sdk/dist/client.js
function createOpencodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      req.timeout = false;
      return fetch(req);
    };
    config = {
      ...config,
      fetch: customFetch
    };
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory
    };
  }
  const client2 = createClient(config);
  return new OpencodeClient({ client: client2 });
}
// src/opencode.ts
var DEFAULT_BASE_URL = "http://localhost:4096";

class OpenCodeConnector {
  client;
  baseUrl;
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
      responseStyle: "data"
    });
  }
  get url() {
    return this.baseUrl;
  }
  async isRunning() {
    try {
      await this.client.project.list({ responseStyle: "data" });
      return true;
    } catch {
      return false;
    }
  }
  async listProjects() {
    const projects = await this.client.project.list({ responseStyle: "data" }) ?? [];
    return projects.map((project) => this.mapProject(project));
  }
  async listSessions(directory) {
    const sessions = await this.client.session.list({
      responseStyle: "data",
      query: directory ? { directory } : undefined
    }) ?? [];
    return sessions.map((session) => this.mapSession(session));
  }
  async createSession(directory, title) {
    const session = await this.client.session.create({
      responseStyle: "data",
      body: title ? { title } : undefined,
      query: directory ? { directory } : undefined
    });
    return this.mapSession(session);
  }
  async getSession(sessionId, directory) {
    const session = await this.client.session.get({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined
    });
    return this.mapSession(session);
  }
  async getSessionMessages(sessionId, directory, limit) {
    return this.client.session.messages({
      responseStyle: "data",
      path: { id: sessionId },
      query: {
        ...directory ? { directory } : {},
        ...limit ? { limit } : {}
      }
    });
  }
  async sendPrompt(sessionId, content, directory, model, agent) {
    return this.client.session.prompt({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        ...model ? { model } : {},
        ...agent ? { agent } : {},
        parts: [
          {
            type: "text",
            text: content
          }
        ]
      }
    });
  }
  async abortSession(sessionId, directory) {
    return this.client.session.abort({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined
    });
  }
  async getSessionDiff(sessionId, directory, messageId) {
    return this.client.session.diff({
      responseStyle: "data",
      path: { id: sessionId },
      query: {
        ...directory ? { directory } : {},
        ...messageId ? { messageID: messageId } : {}
      }
    });
  }
  async listFiles(path, directory) {
    return this.client.file.list({
      responseStyle: "data",
      query: {
        path,
        ...directory ? { directory } : {}
      }
    });
  }
  async listProviders() {
    return this.client.config.providers({ responseStyle: "data" });
  }
  async getConfig() {
    return this.client.config.get({ responseStyle: "data" });
  }
  async updateModel(model) {
    return this.client.config.update({
      responseStyle: "data",
      body: {
        model
      }
    });
  }
  async startServer() {
    const running = await this.isRunning();
    if (running)
      return true;
    try {
      Bun.spawn(["opencode", "serve"], {
        stdout: "inherit",
        stderr: "inherit"
      });
    } catch {
      return false;
    }
    return this.waitForRunning();
  }
  async waitForRunning(retries = 6, delayMs = 900) {
    for (var attempt = 0;attempt < retries; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (await this.isRunning())
        return true;
    }
    return false;
  }
  async respondToPermission(sessionId, permissionId, response, directory) {
    return this.client.postSessionIdPermissionsPermissionId({
      responseStyle: "data",
      path: { id: sessionId, permissionID: permissionId },
      query: directory ? { directory } : undefined,
      body: { response }
    });
  }
  async startEventStream(onEvent) {
    const controller = new AbortController;
    const { stream } = await this.client.global.event({
      signal: controller.signal,
      responseStyle: "data"
    });
    (async () => {
      try {
        for await (const event of stream) {
          onEvent(event);
        }
      } catch {}
    })();
    return controller;
  }
  async getLspStatus(directory) {
    try {
      const response = await this.client.lsp.list({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      const lspServers = response ?? [];
      return lspServers.map((server2) => ({
        id: server2.id ?? server2.name ?? "unknown",
        name: server2.name ?? server2.id ?? "LSP Server",
        language: server2.language,
        status: server2.status === "running" ? "running" : server2.status === "error" ? "error" : "stopped",
        root: server2.root
      }));
    } catch {
      return [];
    }
  }
  async getSessionContext(sessionId, directory) {
    const messages = await this.getSessionMessages(sessionId, directory);
    const diffs = await this.getSessionDiff(sessionId, directory);
    const lsp = await this.getLspStatus(directory);
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    for (const msg of messages ?? []) {
      const info = msg?.info;
      if (info?.role === "assistant") {
        const tokens = info.tokens;
        if (tokens) {
          inputTokens += tokens.input ?? 0;
          outputTokens += tokens.output ?? 0;
        }
        totalCost += info.cost ?? 0;
      }
    }
    const modifiedFiles = (diffs ?? []).map((diff) => ({
      file: diff.file ?? "",
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0
    }));
    const contextWindow = 200000;
    return {
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
        contextWindow
      },
      cost: totalCost,
      lsp,
      modifiedFiles
    };
  }
  async getTodos(sessionId, directory) {
    try {
      const todos = await this.client.session.todo({
        responseStyle: "data",
        path: { id: sessionId },
        query: directory ? { directory } : undefined
      });
      return (todos ?? []).map((todo) => ({
        id: todo.id ?? "",
        content: todo.content ?? "",
        status: todo.status ?? "pending",
        priority: todo.priority ?? "medium"
      }));
    } catch {
      return [];
    }
  }
  async listCommands(directory) {
    try {
      const commands = await this.client.command.list({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return (commands ?? []).map((cmd) => ({
        name: cmd.name ?? "",
        description: cmd.description,
        builtin: cmd.builtin ?? false
      }));
    } catch {
      return [];
    }
  }
  async executeCommand(sessionId, command, args, directory, agent, model) {
    return this.client.session.command({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        command,
        arguments: args,
        ...agent ? { agent } : {},
        ...model ? { model } : {}
      }
    });
  }
  async listAgents(directory) {
    try {
      const agents = await this.client.app.agents({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return (agents ?? []).map((agent) => ({
        name: agent.name ?? "",
        description: agent.description,
        color: agent.color,
        mode: agent.mode ?? "primary"
      }));
    } catch {
      return [];
    }
  }
  async deleteSession(sessionId, directory) {
    try {
      await this.client.session.delete({
        responseStyle: "data",
        path: { id: sessionId },
        query: directory ? { directory } : undefined
      });
      return true;
    } catch {
      return false;
    }
  }
  async updateSession(sessionId, title, archived, directory) {
    const session = await this.client.session.update({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        ...title ? { title } : {},
        ...archived !== undefined ? { time: { archived: archived ? Date.now() : undefined } } : {}
      }
    });
    return this.mapSession(session);
  }
  async forkSession(sessionId, messageId, directory) {
    const session = await this.client.session.fork({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: messageId ? { messageID: messageId } : undefined
    });
    return this.mapSession(session);
  }
  async revertMessage(sessionId, messageId, partId, directory) {
    const session = await this.client.session.revert({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        messageID: messageId,
        ...partId ? { partID: partId } : {}
      }
    });
    return this.mapSession(session);
  }
  async unrevertSession(sessionId, directory) {
    const session = await this.client.session.unrevert({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined
    });
    return this.mapSession(session);
  }
  async shareSession(sessionId, directory) {
    const session = await this.client.session.share({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined
    });
    return this.mapSession(session);
  }
  async unshareSession(sessionId, directory) {
    const session = await this.client.session.unshare({
      responseStyle: "data",
      path: { id: sessionId },
      query: directory ? { directory } : undefined
    });
    return this.mapSession(session);
  }
  async summarizeSession(sessionId, providerID, modelID, directory) {
    try {
      await this.client.session.summarize({
        responseStyle: "data",
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
        body: {
          providerID,
          modelID
        }
      });
      return true;
    } catch {
      return false;
    }
  }
  async getVcsInfo(directory) {
    try {
      const vcs = await this.client.vcs.get({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return {
        branch: vcs?.branch
      };
    } catch {
      return {};
    }
  }
  async readFile(path, directory) {
    try {
      const result = await this.client.file.read({
        responseStyle: "data",
        query: {
          path,
          ...directory ? { directory } : {}
        }
      });
      return {
        content: result?.content ?? "",
        mime: result?.mime ?? "text/plain"
      };
    } catch {
      return { content: "", mime: "text/plain" };
    }
  }
  async findFiles(query, directory) {
    try {
      const result = await this.client.find.files({
        responseStyle: "data",
        query: {
          query,
          ...directory ? { directory } : {}
        }
      });
      return result ?? [];
    } catch {
      return [];
    }
  }
  async findText(pattern, include, directory) {
    try {
      const result = await this.client.find.text({
        responseStyle: "data",
        query: {
          pattern,
          ...include ? { include } : {},
          ...directory ? { directory } : {}
        }
      });
      return (result ?? []).map((item) => ({
        path: item.path?.text ?? item.path ?? "",
        lineNumber: item.line_number ?? item.lineNumber ?? 0,
        lineText: item.lines?.text ?? "",
        matches: (item.submatches ?? []).map((m) => ({
          text: m.match?.text ?? "",
          start: m.start ?? 0,
          end: m.end ?? 0
        }))
      }));
    } catch {
      return [];
    }
  }
  async findSymbols(query, directory) {
    try {
      const result = await this.client.find.symbols({
        responseStyle: "data",
        query: {
          query,
          ...directory ? { directory } : {}
        }
      });
      return (result ?? []).map((item) => ({
        name: item.name ?? "",
        kind: item.kind ?? "unknown",
        path: item.path ?? item.location?.uri ?? "",
        line: item.line ?? item.location?.range?.start?.line ?? 0,
        column: item.column ?? item.location?.range?.start?.character ?? 0
      }));
    } catch {
      return [];
    }
  }
  async getSessionStatus(directory) {
    try {
      const result = await this.client.session.status({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      const mapped = {};
      for (const [sessionId, status] of Object.entries(result ?? {})) {
        const s = status;
        if (s.type === "busy") {
          mapped[sessionId] = { type: "busy" };
        } else if (s.type === "retry") {
          mapped[sessionId] = {
            type: "retry",
            attempt: s.attempt ?? 0,
            message: s.message ?? "",
            next: s.next ?? 0
          };
        } else {
          mapped[sessionId] = { type: "idle" };
        }
      }
      return mapped;
    } catch {
      return {};
    }
  }
  async listPty(directory) {
    try {
      const result = await this.client.pty.list({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return (result ?? []).map((pty) => this.mapPtySession(pty));
    } catch {
      return [];
    }
  }
  async createPty(command, args, cwd, title, directory) {
    try {
      const result = await this.client.pty.create({
        responseStyle: "data",
        query: directory ? { directory } : undefined,
        body: {
          ...command ? { command } : {},
          ...args ? { args } : {},
          ...cwd ? { cwd } : {},
          ...title ? { title } : {}
        }
      });
      return result ? this.mapPtySession(result) : null;
    } catch {
      return null;
    }
  }
  async getPty(ptyId, directory) {
    try {
      const result = await this.client.pty.get({
        responseStyle: "data",
        path: { id: ptyId },
        query: directory ? { directory } : undefined
      });
      return result ? this.mapPtySession(result) : null;
    } catch {
      return null;
    }
  }
  async updatePty(ptyId, title, rows, cols, directory) {
    try {
      const result = await this.client.pty.update({
        responseStyle: "data",
        path: { id: ptyId },
        query: directory ? { directory } : undefined,
        body: {
          ...title ? { title } : {},
          ...rows && cols ? { size: { rows, cols } } : {}
        }
      });
      return result ? this.mapPtySession(result) : null;
    } catch {
      return null;
    }
  }
  async deletePty(ptyId, directory) {
    try {
      await this.client.pty.remove({
        responseStyle: "data",
        path: { id: ptyId },
        query: directory ? { directory } : undefined
      });
      return true;
    } catch {
      return false;
    }
  }
  async getMcpStatus(directory) {
    try {
      const result = await this.client.mcp.status({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      const mapped = {};
      for (const [name, status] of Object.entries(result ?? {})) {
        const s = status;
        mapped[name] = {
          name,
          status: s.status ?? "disconnected",
          error: s.error,
          tools: s.tools ?? [],
          resources: s.resources ?? []
        };
      }
      return mapped;
    } catch {
      return {};
    }
  }
  async connectMcp(name, directory) {
    try {
      await this.client.mcp.connect({
        responseStyle: "data",
        path: { name },
        query: directory ? { directory } : undefined
      });
      return true;
    } catch {
      return false;
    }
  }
  async disconnectMcp(name, directory) {
    try {
      await this.client.mcp.disconnect({
        responseStyle: "data",
        path: { name },
        query: directory ? { directory } : undefined
      });
      return true;
    } catch {
      return false;
    }
  }
  async listAllProviders(directory) {
    try {
      const result = await this.client.provider.list({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return {
        all: (result?.all ?? []).map((p) => ({
          id: p.id ?? "",
          name: p.name ?? p.id ?? "",
          models: p.models ?? {}
        })),
        default: result?.default ?? {},
        connected: result?.connected ?? []
      };
    } catch {
      return { all: [], default: {}, connected: [] };
    }
  }
  async getProviderAuth(directory) {
    try {
      const result = await this.client.provider.auth({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      const mapped = {};
      for (const [providerId, methods] of Object.entries(result ?? {})) {
        mapped[providerId] = methods.map((m) => ({
          type: m.type ?? "api",
          name: m.name ?? "",
          description: m.description,
          url: m.url
        }));
      }
      return mapped;
    } catch {
      return {};
    }
  }
  async setApiKey(providerID, key, directory) {
    try {
      await this.client.auth.set({
        responseStyle: "data",
        path: { provider: providerID },
        query: directory ? { directory } : undefined,
        body: {
          type: "api",
          key
        }
      });
      return true;
    } catch {
      return false;
    }
  }
  async listToolIds(directory) {
    try {
      const result = await this.client.experimental.toolIds({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return result ?? [];
    } catch {
      return [];
    }
  }
  async listTools(provider, model, directory) {
    try {
      const result = await this.client.experimental.tools({
        responseStyle: "data",
        query: {
          provider,
          model,
          ...directory ? { directory } : {}
        }
      });
      return (result ?? []).map((tool) => ({
        id: tool.id ?? tool.name ?? "",
        name: tool.name ?? tool.id ?? "",
        description: tool.description,
        enabled: tool.enabled ?? true
      }));
    } catch {
      return [];
    }
  }
  async getFileStatus(directory) {
    try {
      const result = await this.client.file.status({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return (result ?? []).map((f) => ({
        path: f.path ?? "",
        status: f.status ?? "modified",
        staged: f.staged ?? false
      }));
    } catch {
      return [];
    }
  }
  async getFormatterStatus(directory) {
    try {
      const result = await this.client.formatter.status({
        responseStyle: "data",
        query: directory ? { directory } : undefined
      });
      return (result ?? []).map((f) => ({
        id: f.id ?? "",
        name: f.name ?? f.id ?? "",
        language: f.language,
        status: f.status ?? "inactive",
        error: f.error
      }));
    } catch {
      return [];
    }
  }
  async initSession(sessionId, providerID, modelID, messageID, directory) {
    try {
      await this.client.session.init({
        responseStyle: "data",
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
        body: {
          providerID,
          modelID,
          messageID
        }
      });
      return true;
    } catch {
      return false;
    }
  }
  mapPtySession(pty) {
    return {
      id: pty.id ?? "",
      title: pty.title ?? "Terminal",
      command: pty.command ?? "",
      args: pty.args ?? [],
      cwd: pty.cwd ?? "",
      status: pty.status === "running" ? "running" : "exited",
      pid: pty.pid ?? 0,
      exitCode: pty.exitCode
    };
  }
  mapProject(project) {
    const path = project.worktree;
    const name = path.split("/").filter(Boolean).pop() ?? path;
    return {
      id: project.id,
      name,
      path,
      lastOpened: project.time?.initialized ?? project.time?.created
    };
  }
  mapSession(session) {
    return {
      id: session.id,
      title: session.title,
      projectID: session.projectID,
      directory: session.directory,
      parentID: session.parentID,
      time: session.time,
      summary: session.summary,
      share: session.share
    };
  }
}

// src/server.ts
function createBridgeServer(options) {
  const sockets = new Set;
  const { opencode, version, logger } = options;
  const log = (message) => {
    logger?.(message);
  };
  const send = (ws, message) => {
    ws.send(JSON.stringify(message));
  };
  const broadcast = (message) => {
    const payload = JSON.stringify(message);
    for (const ws of sockets) {
      ws.send(payload);
    }
  };
  const handleHttp = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return jsonResponse({ status: "ok", version });
    }
    if (url.pathname === "/projects") {
      try {
        const data = await opencode.listProjects();
        return jsonResponse(data);
      } catch (error) {
        return jsonResponse({ error: toErrorMessage(error) }, 500);
      }
    }
    if (url.pathname === "/browse") {
      const path = url.searchParams.get("path");
      if (!path) {
        return jsonResponse({ error: "Missing path" }, 400);
      }
      try {
        const data = await opencode.listFiles(path);
        return jsonResponse({ path, items: data });
      } catch (error) {
        return jsonResponse({ error: toErrorMessage(error) }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  };
  const server2 = Bun.serve({
    port: options.port,
    fetch(request, serverInstance) {
      if (serverInstance.upgrade(request))
        return;
      return handleHttp(request);
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        log(`Client connected (${sockets.size} total)`);
        sendStatus(ws);
      },
      close(ws) {
        sockets.delete(ws);
        log(`Client disconnected (${sockets.size} total)`);
      },
      message(ws, raw) {
        handleMessage(ws, raw);
      }
    }
  });
  const sendStatus = async (ws) => {
    const running = await opencode.isRunning();
    send(ws, { type: "status", data: { opencodeRunning: running } });
  };
  const handleMessage = async (ws, raw) => {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send(ws, { type: "error", message: "Invalid JSON payload" });
      return;
    }
    const requestId = message.requestId;
    const reply = (response) => {
      send(ws, requestId ? { ...response, requestId } : response);
    };
    try {
      switch (message.type) {
        case "list_projects": {
          const projects = await opencode.listProjects();
          reply({ type: "projects", data: projects });
          break;
        }
        case "list_sessions": {
          const sessions = await opencode.listSessions(message.projectPath);
          reply({ type: "sessions", data: sessions, projectPath: message.projectPath });
          break;
        }
        case "list_providers": {
          const providers = await opencode.listProviders();
          reply({ type: "providers", data: providers });
          break;
        }
        case "get_config": {
          const config = await opencode.getConfig();
          reply({ type: "config", data: config });
          break;
        }
        case "set_model": {
          await opencode.updateModel(message.model);
          const config = await opencode.getConfig();
          reply({ type: "config", data: config });
          break;
        }
        case "start_opencode": {
          const started = await opencode.startServer();
          broadcast({ type: "status", data: { opencodeRunning: started } });
          if (!started) {
            reply({
              type: "error",
              message: "Failed to start OpenCode. Run `opencode serve` on your Mac."
            });
          }
          break;
        }
        case "create_session": {
          const session = await opencode.createSession(message.projectPath, message.title);
          reply({ type: "session_created", data: session });
          break;
        }
        case "get_session": {
          const session = await opencode.getSession(message.sessionId, message.projectPath);
          reply({ type: "session", data: session });
          break;
        }
        case "get_session_messages": {
          const messages = await opencode.getSessionMessages(message.sessionId, message.projectPath, message.limit);
          reply({ type: "session_messages", data: messages, sessionId: message.sessionId });
          break;
        }
        case "chat": {
          await opencode.sendPrompt(message.sessionId, message.content, message.projectPath, message.model, message.agent);
          break;
        }
        case "abort": {
          await opencode.abortSession(message.sessionId, message.projectPath);
          break;
        }
        case "diff": {
          const diff = await opencode.getSessionDiff(message.sessionId, message.projectPath, message.messageId);
          reply({ type: "diff", data: diff, sessionId: message.sessionId });
          break;
        }
        case "browse": {
          const items = await opencode.listFiles(message.path, message.projectPath);
          reply({ type: "browse_result", data: { path: message.path, items } });
          break;
        }
        case "permission_response": {
          await opencode.respondToPermission(message.sessionId, message.permissionId, message.response, message.projectPath);
          break;
        }
        case "get_lsp_status": {
          const lspStatus = await opencode.getLspStatus(message.projectPath);
          reply({ type: "lsp_status", data: lspStatus });
          break;
        }
        case "get_session_context": {
          const context = await opencode.getSessionContext(message.sessionId, message.projectPath);
          reply({ type: "session_context", data: context, sessionId: message.sessionId });
          break;
        }
        case "get_todos": {
          const todos = await opencode.getTodos(message.sessionId, message.projectPath);
          reply({ type: "todos", data: todos, sessionId: message.sessionId });
          break;
        }
        case "list_commands": {
          const commands = await opencode.listCommands(message.projectPath);
          reply({ type: "commands", data: commands });
          break;
        }
        case "execute_command": {
          const result = await opencode.executeCommand(message.sessionId, message.command, message.arguments, message.projectPath, message.agent, message.model);
          reply({ type: "command_executed", data: result, sessionId: message.sessionId });
          break;
        }
        case "list_agents": {
          const agents = await opencode.listAgents(message.projectPath);
          reply({ type: "agents", data: agents });
          break;
        }
        case "delete_session": {
          const deleted = await opencode.deleteSession(message.sessionId, message.projectPath);
          reply({ type: "session_deleted", data: deleted, sessionId: message.sessionId });
          break;
        }
        case "update_session": {
          const session = await opencode.updateSession(message.sessionId, message.title, message.archived, message.projectPath);
          reply({ type: "session_updated", data: session, sessionId: message.sessionId });
          break;
        }
        case "fork_session": {
          const session = await opencode.forkSession(message.sessionId, message.messageId, message.projectPath);
          reply({ type: "session_forked", data: session });
          break;
        }
        case "revert_message": {
          const session = await opencode.revertMessage(message.sessionId, message.messageId, message.partId, message.projectPath);
          reply({ type: "message_reverted", data: session, sessionId: message.sessionId });
          break;
        }
        case "unrevert_session": {
          const session = await opencode.unrevertSession(message.sessionId, message.projectPath);
          reply({ type: "session_unreverted", data: session, sessionId: message.sessionId });
          break;
        }
        case "share_session": {
          const session = await opencode.shareSession(message.sessionId, message.projectPath);
          reply({ type: "session_shared", data: session, sessionId: message.sessionId });
          break;
        }
        case "unshare_session": {
          const session = await opencode.unshareSession(message.sessionId, message.projectPath);
          reply({ type: "session_unshared", data: session, sessionId: message.sessionId });
          break;
        }
        case "summarize_session": {
          const success = await opencode.summarizeSession(message.sessionId, message.providerID, message.modelID, message.projectPath);
          reply({ type: "session_summarized", data: success, sessionId: message.sessionId });
          break;
        }
        case "get_vcs": {
          const vcs = await opencode.getVcsInfo(message.projectPath);
          reply({ type: "vcs", data: vcs });
          break;
        }
        case "read_file": {
          const content = await opencode.readFile(message.path, message.projectPath);
          reply({ type: "file_content", data: content, path: message.path });
          break;
        }
        case "find_files": {
          const files = await opencode.findFiles(message.query, message.projectPath);
          reply({ type: "files_found", data: files });
          break;
        }
        case "find_text": {
          const results = await opencode.findText(message.pattern, message.include, message.projectPath);
          reply({ type: "text_found", data: results });
          break;
        }
        case "find_symbols": {
          const symbols = await opencode.findSymbols(message.query, message.projectPath);
          reply({ type: "symbols_found", data: symbols });
          break;
        }
        case "get_session_status": {
          const status = await opencode.getSessionStatus(message.projectPath);
          reply({ type: "session_status", data: status });
          break;
        }
        case "list_pty": {
          const ptys = await opencode.listPty(message.projectPath);
          reply({ type: "pty_list", data: ptys });
          break;
        }
        case "create_pty": {
          const pty = await opencode.createPty(message.command, message.args, message.cwd, message.title, message.projectPath);
          if (pty) {
            reply({ type: "pty_created", data: pty });
          } else {
            reply({ type: "error", message: "Failed to create PTY session" });
          }
          break;
        }
        case "get_pty": {
          const pty = await opencode.getPty(message.ptyId, message.projectPath);
          if (pty) {
            reply({ type: "pty", data: pty });
          } else {
            reply({ type: "error", message: "PTY session not found" });
          }
          break;
        }
        case "update_pty": {
          const pty = await opencode.updatePty(message.ptyId, message.title, message.rows, message.cols, message.projectPath);
          if (pty) {
            reply({ type: "pty_updated", data: pty });
          } else {
            reply({ type: "error", message: "Failed to update PTY session" });
          }
          break;
        }
        case "delete_pty": {
          const deleted = await opencode.deletePty(message.ptyId, message.projectPath);
          reply({ type: "pty_deleted", data: deleted, ptyId: message.ptyId });
          break;
        }
        case "get_mcp_status": {
          const status = await opencode.getMcpStatus(message.projectPath);
          reply({ type: "mcp_status", data: status });
          break;
        }
        case "connect_mcp": {
          const connected = await opencode.connectMcp(message.name, message.projectPath);
          reply({ type: "mcp_connected", data: connected, name: message.name });
          break;
        }
        case "disconnect_mcp": {
          const disconnected = await opencode.disconnectMcp(message.name, message.projectPath);
          reply({ type: "mcp_disconnected", data: disconnected, name: message.name });
          break;
        }
        case "list_all_providers": {
          const providers = await opencode.listAllProviders(message.projectPath);
          reply({ type: "all_providers", data: providers });
          break;
        }
        case "get_provider_auth": {
          const auth = await opencode.getProviderAuth(message.projectPath);
          reply({ type: "provider_auth", data: auth });
          break;
        }
        case "set_api_key": {
          const success = await opencode.setApiKey(message.providerID, message.key, message.projectPath);
          reply({ type: "api_key_set", data: success, providerID: message.providerID });
          break;
        }
        case "list_tool_ids": {
          const toolIds = await opencode.listToolIds(message.projectPath);
          reply({ type: "tool_ids", data: toolIds });
          break;
        }
        case "list_tools": {
          const tools = await opencode.listTools(message.provider, message.model, message.projectPath);
          reply({ type: "tools", data: tools });
          break;
        }
        case "get_file_status": {
          const fileStatus = await opencode.getFileStatus(message.projectPath);
          reply({ type: "file_status", data: fileStatus });
          break;
        }
        case "get_formatter_status": {
          const formatterStatus = await opencode.getFormatterStatus(message.projectPath);
          reply({ type: "formatter_status", data: formatterStatus });
          break;
        }
        case "init_session": {
          const initialized = await opencode.initSession(message.sessionId, message.providerID, message.modelID, message.messageID, message.projectPath);
          reply({ type: "session_initialized", data: initialized, sessionId: message.sessionId });
          break;
        }
        default: {
          reply({ type: "error", message: "Unknown message type" });
        }
      }
    } catch (error) {
      reply({ type: "error", message: toErrorMessage(error) });
    }
  };
  return {
    broadcast,
    stop: () => server2.stop(true),
    connections: () => sockets.size
  };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
function toErrorMessage(error) {
  if (error instanceof Error)
    return error.message;
  return String(error);
}

// src/index.ts
var DEFAULT_PORT = 18274;
async function main() {
  const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const version = packageJson.version ?? "0.1.0";
  displayBanner();
  const port = Number(process.env.BROSKI_PORT ?? DEFAULT_PORT);
  const opencodeUrl = process.env.OPENCODE_BASE_URL ?? "http://localhost:4096";
  const opencode = new OpenCodeConnector({ baseUrl: opencodeUrl });
  const opencodeRunning = await ensureOpenCodeRunning(opencode);
  if (!opencodeRunning) {
    console.log("\u26A0\uFE0F  OpenCode is not running. Start it with: opencode serve");
  } else {
    console.log("\u2713 OpenCode detected");
  }
  const localIP = getLocalIP();
  const tailscaleIP = await getTailscaleIP();
  const tailscaleConnected = await isTailscaleConnected();
  if (!tailscaleConnected) {
    console.log("\u2139\uFE0F  Tailscale not connected. Local network access only.");
  }
  const server2 = createBridgeServer({
    port,
    opencode,
    version,
    logger: (message) => console.log(message)
  });
  await opencode.startEventStream((event) => {
    console.log("[SDK Event]", JSON.stringify(event, null, 2));
    server2.broadcast({ type: "sdk_event", data: event });
  });
  displayQRCode({
    localIP,
    tailscaleIP,
    port,
    version
  });
  console.log(`Bridge listening on port ${port}`);
}
async function ensureOpenCodeRunning(opencode) {
  const running = await opencode.isRunning();
  if (running)
    return true;
  const shouldAutoStart = process.env.BROSKI_AUTOSTART_OPENCODE === "1";
  if (!shouldAutoStart)
    return false;
  console.log("Starting OpenCode server...");
  return opencode.startServer();
}
main();
