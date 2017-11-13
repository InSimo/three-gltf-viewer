/**
 * Parse a Draco buffer, not to efficiently decompress it but rather to
 * check the specification and discover compression options that were used.
 * @author Jeremie Allard / https://twitter.com/JeremieAllard
 */

// https://google.github.io/draco/spec/

// Draco standard enum constants
// (taken from the bitstream specification)
const DRACO = {
  EncoderMethod: {
    MESH_SEQUENTIAL_ENCODING: 0,
    MESH_EDGEBREAKER_ENCODING: 1
  },
  SequentialIndicesEncodingMethod: {
    SEQUENTIAL_COMPRESSED_INDICES: 0,
    SEQUENTIAL_UNCOMPRESSED_INDICES: 1
  },
  HeaderFlagBit: {
    METADATA_FLAG_BIT: 15
  },
  EncoderType: {
    POINT_CLOUD: 0,
    TRIANGULAR_MESH: 1
  },
  AttributeDecoderType: {
    MESH_VERTEX_ATTRIBUTE: 0,
    MESH_CORNER_ATTRIBUTE: 1
  },
  EBEncodingMethod: {
    STANDARD_EDGEBREAKER: 0,
    VALENCE_EDGEBREAKER: 2
  },
  AttributeDecoderMethod: {
    MESH_TRAVERSAL_DEPTH_FIRST: 0,
    MESH_TRAVERSAL_PREDICTION_DEGREE: 1
  },
  SymbolEncodingMethod: {
    TAGGED_SYMBOLS: 0,
    RAW_SYMBOLS: 1
  },
  EBBitPattern: {
    TOPOLOGY_C: 0,
    TOPOLOGY_S: 1,
    TOPOLOGY_L: 3,
    TOPOLOGY_R: 5,
    TOPOLOGY_E: 7
  },
  EBEdge: {
    LEFT_FACE_EDGE: 0,
    RIGHT_FACE_EDGE : 1
  },
  EBValence: {
    MIN_VALENCE: 2,
    MAX_VALENCE: 7,
    NUM_UNIQUE_VALENCES: 6
  }
};

// Draco standard value constants

const kInvalidCornerIndex = -1;
const rabs_ans_p8_precision = 256;
const rabs_ans_p8_precision_bits = 8;
const rabs_ans_p8_precision_mask = rabs_ans_p8_precision-1;
const rabs_l_base = 4096;
const IO_BASE = 256;
const L_RANS_BASE = 4096;
const TAGGED_RANS_BASE = 16384;
const TAGGED_RANS_PRECISION = 4096;

// Reverse the DRACO constants to get a simple value -> string conversion
const D2S = {};
for(let [key, value] of Object.entries(DRACO)) {
  D2S[key] = [];
  for(let [key2, value2] of Object.entries(value)) {
    D2S[key][value2] = key2;
  }
}

module.exports = class DracoInspector {

  constructor () {
  }

  inspectDraco(dracoData) {
    var res = {}
    try {
      this.parseDraco(dracoData, res);
    }
    catch(e) {
      console.error(e);
      res.error = e.message;
    }
    return res;
  }

  parseDraco(dracoData, res) {
    const dracoView = new DataView(dracoData);
    var dracoOffset = 0;
    let dracoOffset0 = 0;

    function getUI8() {
      var r = dracoView.getUint8(dracoOffset);
      dracoOffset+=1;
      return r;
    }

    function getUI8Array(sz) {
      var r = new Uint8Array(dracoData, dracoOffset, sz);
      dracoOffset+=sz;
      return r;
    }

    function getUI16() {
      var r = dracoView.getUint16(dracoOffset, true);
      dracoOffset+=2;
      return r;
    }

    function getUI32() {
      var r = dracoView.getUint32(dracoOffset, true);
      dracoOffset+=4;
      return r;
    }

    function getVarUI32() {
      var r = 0, s = 0, i;
      do {
        i = dracoView.getUint8(dracoOffset);
        dracoOffset+=1;
        r |= (i&127) << s;
        s += 7;
      }
      while(i&128);
      return r;
    }

    function getVarUI32() {
      var r = 0, s = 0, i;
      do {
        i = dracoView.getUint8(dracoOffset);
        dracoOffset+=1;
        r |= (i&127) << s;
        s += 7;
      }
      while(i&128);
      return r;
    }

    function getVarUI64() {
      return getVarUI32(); // TODO: handle values larger than 32 bits
    }

    var dracoOffsetBits = 0;

    function getBit() {
      let b0 = dracoOffsetBits&7;
      let r = (dracoView.getUint8(dracoOffset + ((dracoOffsetBits+7)>>>3)) >>> b0)&1;
      dracoOffsetBits += 1;
      return r;
    }

    function getBits(n) {
      let r = 0, s = 0;
      while (n > 0) {
        // read all the bits available in the same byte
        let b0 = dracoOffsetBits&7;
        let nb = Math.min(n,8-b0);
        r |= ((dracoView.getUint8(dracoOffset+(dracoOffsetBits>>>3)) >>> b0) & ((1 << nb)-1)) << s;
        dracoOffsetBits += nb;
        s += nb;
        n -= nb;
      }
      return r;
    }
    function skipBits(n) {
      dracoOffsetBits += n;
    }
    function ResetBitReader() {
      dracoOffset += ((dracoOffsetBits+7)>>>3);
      dracoOffsetBits = 0;
    }

    function RansInitDecoder(buf, offset, l_rans_base) {
      let ans = {};
      ans.buf = buf;
      let x = buf[offset - 1] >> 6;
      if (x == 0) {
        ans.buf_offset = offset - 1;
        ans.state = buf[offset - 1] & 0x3F;
      } else if (x == 1) {
        ans.buf_offset = offset - 2;
        ans.state = (buf[offset - 2] | (buf[offset - 1]<<8)) & 0x3FFF;
      } else if (x == 2) {
        ans.buf_offset = offset - 3;
        ans.state = (buf[offset - 3] | (buf[offset - 2]<<8) | (buf[offset - 1]<<16)) & 0x3FFFFF;
      } else if (x == 3) {
        ans.buf_offset = offset - 4;
        ans.state = (buf[offset - 4] | (buf[offset - 3]<<8) | (buf[offset - 2]<<16) |
                     (buf[offset - 3]<<24)) & 0x3FFFFF;
      }
      ans.state += l_rans_base;
      return ans;
    }
    function RansRead(ans, l_rans_base, rans_precision, lut_table_, probability_table_) {
      while (ans.state < l_rans_base && ans.buf_offset > 0) {
        ans.state = ans.state * IO_BASE + ans.buf[--ans.buf_offset];
      }
      quo = Math.floor(ans.state / rans_precision);
      rem = ans.state % rans_precision;
      //sym = fetch_sym(rem, lut_table_, probability_table_);
      let symbol = lut_table_[rem];
      let symp = probability_table_[symbol];
      ans.state = quo * symp.prob + rem - symp.cum_prob;
      return sym.val;
    }

    function RabsDescRead(ans, p0) {
      let p = rabs_ans_p8_precision - p0;
      if (ans.state < rabs_l_base) {
        ans.state = ans.state * IO_BASE + ans.buf[--ans.buf_offset];
      }
      let x = ans.state;
      let quot = x >>> rabs_ans_p8_precision_bits;
      let rem = x & rabs_ans_p8_precision_mask;
      let xn = quot * p;
      let val = rem < p;
      if (val) {
        ans.state = xn + rem;
      } else {
        ans.state = x - xn - p;
      }
      return val;
    }

    function BuildSymbolTables(num_symbols, lut_table_, probability_table_) {
      probability_table_.length = num_symbols;
      lut_table_.length = 0;
      let token_probs = new Array(num_symbols).fill(0);
      for (let i = 0; i < num_symbols; ++i) {
        let prob_data = getUI8();
        let token = prob_data & 3;
        if (token == 3) {
          const offset = prob_data >> 2;
          i += offset;
        } else {
          let prob = prob_data >>> 2;
          for (let j = 0; j < token; ++j) {
            prob |= (getUI8() << (8*(j+1)-2));
          }
          token_probs[i] = prob;
        }
      }
      // rans_build_look_up_table
      let cum_prob = 0;
      let act_prob = 0;
      for (let i = 0; i < num_symbols; ++i) {
        probability_table_[i] = { prob: token_probs[i], cum_prob: cum_prob };
        cum_prob += token_probs[i];
        lut_table_.fill(i, act_prob, cum_prob);
        act_prob = cum_prob;
      }
    }

    function DecodeSymbols(num_values, num_components, out_values) {
      const scheme = getUI8();
      if (scheme == DRACO.SymbolEncodingMethod.TAGGED_SYMBOLS) {
        //DecodeTaggedSymbols
        const num_symbols = getVarUI32();
        let lut_table_ = [];
        let probability_table_ = [];
        BuildSymbolTables(num_symbols, lut_table_, probability_table_);
        const size = getVarUI64();
        let encoded_data = getU8Array(size);
        let ans_decoder_ = RansInitDecoder(encoded_data, size, TAGGED_RANS_BASE);
        for (let i = 0; i < num_values; i += num_components) {
          let s = RansRead(ans_decoder_, TAGGED_RANS_BASE, TAGGED_RANS_PRECISION,
                           lut_table_, probability_table_);
          for (let j = 0; j < num_components; ++j) {
            let val = getBits(s);
            out_values.push(val);
          }
        }
        ResetBitReader();
      } else if (scheme == DRACO.SymbolEncodingMethod.RAW_SYMBOLS) {
        //DecodeRawSymbols
        const max_bit_length = getUI8();
        const num_symbols = getVarUI32();
        var rans_precision_bits  = (3 * max_bit_length) >> 1;
        if (rans_precision_bits > 20)
          rans_precision_bits = 20;
        if (rans_precision_bits < 12)
          rans_precision_bits = 12;
        const rans_precision = 1 << rans_precision_bits;
        const l_rans_base = rans_precision * 4;
        let lut_table_ = [];
        let probability_table_ = [];
        BuildSymbolTables(num_symbols, lut_table_, probability_table_);

        const size = getVarUI64();
        let buffer = getUI8Array(size);
        let ans_decoder_ = RansInitDecoder(buffer, size, l_rans_base);
        for (let i = 0; i < num_values; ++i) {
          let val = RansRead(ans_decoder_, l_rans_base, rans_precision,
                             lut_table_, probability_table_);
          out_values.push(val);
        }
      }
    }

    //
    // draco header
    //
    var draco_string = '';
    for (let i = 0; i < 5; ++i) {
      draco_string += String.fromCharCode(dracoView.getUint8(dracoOffset+i));
    }
    dracoOffset += 5;
    if (draco_string !== 'DRACO') {
      throw new Error('draco_string mismatch: "'+draco_string+'"');
    }
    const major_version  = getUI8();
    const minor_version  = getUI8();
    const version = (major_version << 8) | minor_version;
    const encoder_type   = getUI8();
    const encoder_method = getUI8();
    const flags          = getUI16();

    res.version = major_version + '.' + minor_version;
    res.encoder_type = D2S.EncoderType[encoder_type] || encoder_type;
    res.encoder_method = D2S.EncoderMethod[encoder_method] || encoder_method;
    res.flags = flags;

    res.headerSize = dracoOffset - dracoOffset0;
    dracoOffset0 = dracoOffset;
    if (flags & (1 << DRACO.HeaderFlagBit.METADATA_FLAG_BIT)) {
      // 4. Metadata Decoder (UNTESTED)
      // (currently ignored, but must parse to skip)

      // 4.6 DecodeMetaDataElement
      function DecodeMetaDataElement() {
        const num_entries = getVarUI32();
        let sz;
        for (let ei = 0; ei < num_entries; ++ei) {
          sz = getUI8();
          dracoOffset += sz; // metadata.key
          sz = getUI8();
          dracoOffset += sz; // metadata.value
        }
        const num_sub_metadata = getVarUI32();
        for (let smdi = 0; smdi < num_sub_metadata; ++smdi) {
          sz = getUI8();
          dracoOffset += sz; // sub_metadata_key
          DecodeMetaDataElement(); // sub_metadata[smdi]
        }
      }

      const num_att_metadata = getVarUI32();
      for (let mdi = 0; mdi < num_att_metadata; ++mdi) {
        const att_metadata_id = getVarUI32();
        DecodeMetaDataElement(); // att_metadata[mdi]
      }
      // file metadata
      DecodeMetaDataElement();

      res.metadataSize = dracoOffset - dracoOffset0;
      dracoOffset0 = dracoOffset;
    }

    // DecodeConnectivityData
    var face_to_vertex = [[], [], []];

    if (encoder_method == DRACO.EncoderMethod.MESH_SEQUENTIAL_ENCODING) {
      // DecodeSequentialConnectivityData
      const num_faces = getVarUI32();
      const num_points = getVarUI32();
      const connectivity_method = getUI8();
      res.num_faces = num_faces;
      res.num_points = num_points;
      res.connectivity_method = D2S.SequentialIndicesEncodingMethod[connectivity_method] || connectivity_method;
      if (connectivity_method == DRACO.SequentialIndicesEncodingMethod.SEQUENTIAL_COMPRESSED_INDICES) {
        // DecodeSequentialCompressedIndices
        let decoded_symbols = []
        DecodeSymbols(num_faces * 3, 1, decoded_symbols);
        let last_index_value = 0;
        for (let fi = 0; fi < num_faces; ++fi) {
          for (let fvi = 0; fvi < 3; ++fvi) {
            let encoded_val = decoded_symbols[fi * 3 + fvi];
            let index_diff = (encoded_val >> 1);
            if (encoded_val & 1)
              index_diff = -index_diff;
            let val = index_diff + last_index_value;
            face_to_vertex[fvi].push(val);
            last_index_value = val;
          }
        }
      } else if (connectivity_method == DRACO.SequentialIndicesEncodingMethod.SEQUENTIAL_UNCOMPRESSED_INDICES) {
        // DecodeSequentialIndices
        if (num_points < 256) {
          //ParseSequentialIndicesUI8();
          for (let fi = 0; fi < num_faces; ++fi) {
            for (let fvi = 0; fvi < 3; ++fvi) {
              let val = getUI8();
              face_to_vertex[fvi].push(val);
            }
          }
        } else if (num_points < (1 << 16)) {
          //ParseSequentialIndicesUI16();
          for (let fi = 0; fi < num_faces; ++fi) {
            for (let fvi = 0; fvi < 3; ++fvi) {
              let val = getUI16();
              face_to_vertex[fvi].push(val);
            }
          }
        } else if (num_points < (1 << 21)) {
          //ParseSequentialIndicesVarUI32();
          for (let fi = 0; fi < num_faces; ++fi) {
            for (let fvi = 0; fvi < 3; ++fvi) {
              let val = getVarUI32();
              face_to_vertex[fvi].push(val);
            }
          }
        } else {
          //ParseSequentialIndicesUI32();
          for (let fi = 0; fi < num_faces; ++fi) {
            for (let fvi = 0; fvi < 3; ++fvi) {
              let val = getUI32();
              face_to_vertex[fvi].push(val);
            }
          }
        }
      }
      else {
        throw new Error('Unknown connectivity method '+connectivity_method);
      }
    }
    else if (encoder_method == DRACO.EncoderMethod.MESH_EDGEBREAKER_ENCODING) {
      // DecodeEdgebreakerConnectivityData
      var curr_att_dec = 0;
      var curr_att = 0;

      // ParseEdgebreakerConnectivityData
      const edgebreaker_traversal_type = getUI8();
      const num_new_vertices = 0;
      // version 2.0 or 2.1
      if (version < 0x202) {
        num_new_vertices = getVarUI32();
      }
      const num_encoded_vertices = getVarUI32();
      const num_faces = getVarUI32();
      const num_attribute_data = getUI8();
      const num_encoded_symbols = getVarUI32();
      const num_encoded_split_symbols = getVarUI32();
      res.num_faces = num_faces;
      res.edgebreaker_traversal_type = D2S.EBEncodingMethod[edgebreaker_traversal_type] || edgebreaker_traversal_type;
      res.num_encoded_vertices = num_encoded_vertices;
      res.num_attribute_data = num_attribute_data;
      res.num_encoded_symbols = num_encoded_symbols;
      res.num_encoded_split_symbols = num_encoded_split_symbols;

      // version 2.0 or 2.1
      if (version < 0x202) {
        var topology_split_decoded_bytes = 0;
        var dracoOffsetConnectivity0 = 0;
        var encoded_connectivity_size = getVarUI32();
        dracoOffsetConnectivity0 = dracoOffset;
        dracoOffset += encoded_connectivity_size;
      }

      //DecodeTopologySplitEvents: ParseTopologySplitEvents & ProcessSplitData
      var last_id = 0;
      const num_topology_splits = getVarUI32();
      var source_symbol_id = new Array(num_topology_splits);
      var split_symbol_id = new Array(num_topology_splits);
      for (let tsi = 0; tsi < num_topology_splits; ++tsi) {
        var source_id_delta = getVarUI32();
        var split_id_delta = getVarUI32();
        source_symbol_id[tsi] = source_id_delta + last_id;
        split_symbol_id[tsi] = source_symbol_id[tsi] - split_id_delta;
        last_id = source_symbol_id[tsi];
      }
      var source_edge_bit = new Array(num_topology_splits);
      for (let tsi = 0; tsi < num_topology_splits; ++tsi) {
        source_edge_bit[tsi] = getBit();
        // version 2.0 or 2.1
        if (version < 0x202) {
          skipBits(1);
        }
      }
      ResetBitReader();

      // version 2.0
      if (version < 0x201) {
        var num_hole_events = getVarUI32();
        var hole_symbol_id = new Array(num_hole_events);
        last_id = 0;
        for (let hei = 0; hei < num_hole_events; ++hei) {
          let delta = getVarUI32();
          hole_symbol_id[hei] = delta + last_id;
          last_id = hole_symbol_id[hei];
        }
      }

      // version 2.0 or 2.1
      if (version < 0x202) {
        topology_split_decoded_bytes = dracoOffset - (dracoOffsetConnectivity0 + encoded_connectivity_size);
        dracoOffset = dracoOffsetConnectivity0;
      }

      //EdgebreakerTraversalStart
      var last_symbol_ = -1;
      var active_context_ = -1;

      if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.STANDARD_EDGEBREAKER) {
        //DecodeEdgebreakerTraversalStandardData
        //ParseEdgebreakerTraversalStandardSymbolData
        var eb_symbol_buffer_size = getVarUI64();
        var eb_symbol_buffer = getUI8Array(eb_symbol_buffer_size);
        //ParseEdgebreakerTraversalStandardFaceData
        var eb_start_face_buffer_prob_zero = getUI8();
        var eb_start_face_buffer_size = getVarUI32();
        var eb_start_face_buffer = getUI8Array(eb_start_face_buffer_size);
        //ParseEdgebreakerTraversalStandardAttributeConnectivityData
        var attribute_connectivity_decoders_prob_zero = new Array(num_attribute_data);
        var attribute_connectivity_decoders_size = new Array(num_attribute_data);
        var attribute_connectivity_decoders_buffer = new Array(num_attribute_data);
        for (let ai = 0; ai < num_attribute_data; ++ai) {
          attribute_connectivity_decoders_prob_zero[ai] = getUI8();
          attribute_connectivity_decoders_size[ai] = getVarUI32();
          attribute_connectivity_decoders_buffer[ai] = getUI8Array(attribute_connectivity_decoders_size[ai]);
        }
      } else if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
        //EdgeBreakerTraversalValenceStart();
        throw new Error('Parsing unimplemented for EdgeBreakerTraversalValenceStart');
      }
      else {
        throw new Error('Unknown traversal method '+edgebreaker_traversal_type);
      }

      var eb_symbol_buffer_offset_bits = 0;
      function eb_symbol_buffer_ReadBits(n) {
        let r = 0, s = 0;
        while (n > 0) {
          // read all the bits available in the same byte
          let b0 = eb_symbol_buffer_offset_bits&7;
          let nb = Math.min(n,8-b0);
          r |= ((eb_symbol_buffer[(eb_symbol_buffer_offset_bits>>>3)] >>> b0) & ((1 << nb)-1)) << s;
          eb_symbol_buffer_offset_bits += nb;
          s += nb;
          n -= nb;
        }
        return r;
      }

      var is_vert_hole_ = new Array(num_encoded_vertices + num_encoded_split_symbols).fill(true);

      var active_corner_stack = [];

      // simple stack on top of a js array
      function active_corner_stack_back() {
        if (active_corner_stack.length == 0) {
          throw new Error("Empty active_corner_stack");
        }
        return active_corner_stack[active_corner_stack.length-1];
      }
      function active_corner_stack_pop_back() {
        if (active_corner_stack.length == 0) {
          throw new Error("Empty active_corner_stack");
        }
        return active_corner_stack.pop();
      }
      function active_corner_stack_set_back(v) {
        if (active_corner_stack.length == 0) {
          throw new Error("Empty active_corner_stack");
        }
        active_corner_stack[active_corner_stack.length-1] = v;
      }
      function active_corner_stack_push_back(v) {
        active_corner_stack.push(v);
      }

      // 24. Corners
      function Next(corner) {
        return (corner < 0) ? corner : ((corner % 3) == 2) ? corner - 2 : corner + 1;
      }
      function Previous(corner) {
        return (corner < 0) ? corner : ((corner % 3) == 0) ? corner + 2 : corner - 1;
      }
      var opposite_corners_ = new Array(num_faces*3).fill(kInvalidCornerIndex);
      function PosOpposite(c) {
        return (c >= opposite_corners_.length) ? -1 : opposite_corners_[c];
      }
      function GetLeftCorner(corner_id) {
        if (corner_id < 0)
          return kInvalidCornerIndex;
        return PosOpposite(Previous(corner_id));
      }
      function GetRightCorner(corner_id) {
        if (corner_id < 0)
          return kInvalidCornerIndex;
        return PosOpposite(Next(corner_id));
      }
      function SwingRight0(corner_id) {
        return Previous(PosOpposite(Previous(corner_id)));
      }
      function SwingLeft0(corner_id) {
        return Next(PosOpposite(Next(corner_id)));
      }
      function SetOppositeCorners(c, opp_c) {
        let max_c = Math.max(c,opp_c);
        if (max_c >= opposite_corners_.length) {
          console.log('Resizing opposite_corners_ to ' + max_c);
          opposite_corners_.fill(kInvalidCornerIndex, opposite_corners_.length, max_c);
        }
        opposite_corners_[c] = opp_c;
        opposite_corners_[opp_c] = c;
      }
      function IsCornerOppositeToSeamEdge(corner) {
        let attr = curr_att_dec - 1;
        return is_edge_on_seam_[attr][corner];
      }
      function AttrOpposite(attr, corner) {
        // TODO: attr is not used ?
        if (IsCornerOppositeToSeamEdge(corner))
          return -1;
        return PosOpposite(corner);
      }
      function Opposite(att_dec, c) {
        if (att_dec == 0 || att_dec_decoder_type[att_dec] == DRACO.AttributeDecoderType.MESH_VERTEX_ATTRIBUTE)
          return PosOpposite(c);
        return AttrOpposite(att_dec - 1, c);
      }
      function SwingRight(att_dec, corner_id) {
        return Previous(Opposite(att_dec, Previous(corner_id)));
      }
      function SwingLeft(att_dec, corner_id) {
        return Next(Opposite(att_dec, Next(corner_id)));
      }
      function CornerToVert(att_dec, corner_id) {
        return CornerToVerts(att_dec, corner_id)[0];
      }
      function CornerToVerts(att_dec, corner_id) {
        let ftv = face_to_vertex;
        if (att_dec != 0 && att_dec_decoder_type[att_dec] != DRACO.AttributeDecoderType.MESH_VERTEX_ATTRIBUTE) {
          ftv = attr_face_to_vertex[att_dec - 1];
        }
        let local = corner_id % 3;
        let face = Math.floor(corner_id / 3);
        if (local == 0) {
          return [ ftv[0][face], ftv[1][face], ftv[2][face] ];
        } else if (local == 1) {
          return [ ftv[1][face], ftv[2][face], ftv[0][face] ];
        } else if (local == 2) {
          return [ ftv[2][face], ftv[0][face], ftv[1][face] ];
        }
      }
      var corner_to_vertex_map_ = [];
      corner_to_vertex_map_[0] = []; //new Array(num_faces*3).fill(kInvalidCornerIndex);
      var vertex_corners = new Array(num_encoded_vertices + num_encoded_split_symbols).fill(kInvalidCornerIndex);
      function MapCornerToVertex(corner_id, vert_id) {
        corner_to_vertex_map_[0][corner_id] = vert_id;
        if (vert_id >= 0) {
          vertex_corners[vert_id] = corner_id;
        }
      }

      //DecodeEdgeBreakerConnectivity
      let last_vert_added = -1;
      for (let esi = 0; esi < num_encoded_symbols; ++esi) {
        //EdgebreakerDecodeSymbol
        if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
          //EdgebreakerValenceDecodeSymbol();
          throw new Error('Parsing unimplemented for EdgebreakerValenceDecodeSymbol');
        } else if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.STANDARD_EDGEBREAKER) {
          //ParseEdgebreakerStandardSymbol
          let symbol = eb_symbol_buffer_ReadBits(1);
          if (symbol != DRACO.EBBitPattern.TOPOLOGY_C) {
            symbol |= (eb_symbol_buffer_ReadBits(2) << 1);
          }
          last_symbol_ = symbol;
        }

        let corner = 3 * esi;

        //NewActiveCornerReached
        let new_corner = corner;
        let symbol_id = esi;
        let check_topology_split = false;
        let topology_split_id = [];
        let split_active_corners = [];
        let corner_a, corner_b, corner_n;
        let vert, next, prev, vertex_n;
        switch (last_symbol_) {
        case DRACO.EBBitPattern.TOPOLOGY_C:
          {
            corner_a = active_corner_stack_back();
            corner_b = Previous(corner_a);
            while (PosOpposite(corner_b) >= 0) {
              let b_opp = PosOpposite(corner_b);
              corner_b = Previous(b_opp);
            }
            SetOppositeCorners(corner_a, new_corner + 1);
            SetOppositeCorners(corner_b, new_corner + 2);
            active_corner_stack_set_back(new_corner);
          }
          vert = CornerToVert(curr_att_dec, Next(corner_a));
          next = CornerToVert(curr_att_dec, Next(corner_b));
          prev = CornerToVert(curr_att_dec, Previous(corner_a));
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[next] += 1;
            vertex_valences_[prev] += 1;
          }
          face_to_vertex[0].push(vert);
          face_to_vertex[1].push(next);
          face_to_vertex[2].push(prev);
          is_vert_hole_[vert] = false;
          MapCornerToVertex(new_corner, vert);
          MapCornerToVertex(new_corner + 1, next);
          MapCornerToVertex(new_corner + 2, prev);
          break;
        case DRACO.EBBitPattern.TOPOLOGY_S:
          {
            corner_b = active_corner_stack_pop_back();
            for (let i = 0; i < topology_split_id.length; ++i) {
              if (topology_split_id[i] == symbol_id) {
                active_corner_stack_push_back(split_active_corners[i]);
              }
            }
            corner_a = active_corner_stack_back();
            SetOppositeCorners(corner_a, new_corner + 2);
            SetOppositeCorners(corner_b, new_corner + 1);
            active_corner_stack_set_back(new_corner);
          }

          vert = CornerToVert(curr_att_dec, Previous(corner_a));
          next = CornerToVert(curr_att_dec, Next(corner_a));
          prev = CornerToVert(curr_att_dec, Previous(corner_b));
          MapCornerToVertex(new_corner, vert);
          MapCornerToVertex(new_corner + 1, next);
          MapCornerToVertex(new_corner + 2, prev);
          corner_n = Next(corner_b);
          vertex_n = CornerToVert(curr_att_dec, corner_n);
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[vert] += vertex_valences_[vertex_n];
          }
          //ReplaceVerts(vertex_n, vert)
          {
            for (let fi = 0; fi < face_to_vertex[0].length; ++fi) {
              for (let fvi = 0; fvi < 3; ++fvi) {
                if (face_to_vertex[fvi][fi] == vertex_n) {
                  face_to_vertex[fvi][fi] = vert;
                }
              }
            }
          }
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[next] += 1;
            vertex_valences_[prev] += 1;
          }
          face_to_vertex[0].push(vert);
          face_to_vertex[1].push(next);
          face_to_vertex[2].push(prev);
          //UpdateCornersAfterMerge(new_corner + 1, vert)
          {
            let opp_corner = PosOpposite(new_corner + 1);
            if (opp_corner >= 0) {
              corner_n = Next(opp_corner);
              while (corner_n >= 0) {
                MapCornerToVertex(corner_n, vert);
                corner_n = SwingLeft0(corner_n);
              }
            }
          }
          vertex_corners[vertex_n] = kInvalidCornerIndex;
          break;
        case DRACO.EBBitPattern.TOPOLOGY_R:
          {
            corner_a = active_corner_stack_back();
            let opp_corner = new_corner + 2;
            SetOppositeCorners(opp_corner, corner_a);
            active_corner_stack_set_back(new_corner);
          }
          check_topology_split = true;
          vert = CornerToVert(curr_att_dec, Previous(corner_a));
          next = CornerToVert(curr_att_dec, Next(corner_a));
          prev = ++last_vert_added;
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[vert] += 1;
            vertex_valences_[next] += 1;
            vertex_valences_[prev] += 2;
          }

          face_to_vertex[0].push(vert);
          face_to_vertex[1].push(next);
          face_to_vertex[2].push(prev);

          MapCornerToVertex(new_corner + 2, prev);
          MapCornerToVertex(new_corner, vert);
          MapCornerToVertex(new_corner + 1, next);
          break;
        case DRACO.EBBitPattern.TOPOLOGY_L:
          {
            corner_a = active_corner_stack_back();
            let opp_corner = new_corner + 1;
            SetOppositeCorners(opp_corner, corner_a);
            active_corner_stack_set_back(new_corner);
          }
          check_topology_split = true;
          vert = CornerToVert(curr_att_dec, Previous(corner_a));
          next = CornerToVert(curr_att_dec, Next(corner_a));
          prev = ++last_vert_added;
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[vert] += 1;
            vertex_valences_[next] += 1;
            vertex_valences_[prev] += 2;
          }

          face_to_vertex[0].push(vert);
          face_to_vertex[1].push(next);
          face_to_vertex[2].push(prev);

          MapCornerToVertex(new_corner + 2, prev);
          MapCornerToVertex(new_corner, vert);
          MapCornerToVertex(new_corner + 1, next);
          break;
        case DRACO.EBBitPattern.TOPOLOGY_E:
          active_corner_stack_push_back(new_corner);
          check_topology_split = true;
          vert = last_vert_added + 1;
          next = vert + 1;
          prev = next + 1;
          if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
            vertex_valences_[vert] += 2;
            vertex_valences_[next] += 2;
            vertex_valences_[prev] += 2;
          }
          face_to_vertex[0].push(vert);
          face_to_vertex[1].push(next);
          face_to_vertex[2].push(prev);
          last_vert_added = prev;
          MapCornerToVertex(new_corner, vert);
          MapCornerToVertex(new_corner + 1, next);
          MapCornerToVertex(new_corner + 2, prev);
          break;
        }

        if (edgebreaker_traversal_type == DRACO.EBEncodingMethod.VALENCE_EDGEBREAKER) {
          // Compute the new context that is going to be used
          // to decode the next symbol.
          let active_valence = vertex_valences_[next];
          let clamped_valence;
          if (active_valence < DRACO.EBValence.MIN_VALENCE) {
            clamped_valence = DRACO.EBValence.MIN_VALENCE;
          } else if (active_valence > DRACO.EBValence.MAX_VALENCE) {
            clamped_valence = DRACO.EBValence.MAX_VALENCE;
          } else {
            clamped_valence = active_valence;
          }
          active_context_ = (clamped_valence - DRACO.EBValence.MIN_VALENCE);
        }

        if (check_topology_split) {
          let encoder_symbol_id = num_encoded_symbols - symbol_id - 1;

          //while (IsTopologySplit(encoder_symbol_id, &split_edge,
          //                       &enc_split_id)) {
          while (source_symbol_id.length > 0 && source_symbol_id[source_symbol_id.length-1] == encoder_symbol_id) {
            let split_edge = source_edge_bit.pop();
            let enc_split_id = split_symbol_id.pop();
            source_symbol_id.pop();

            let act_top_corner = active_corner_stack_back();
            let new_active_corner;
            if (split_edge == DRACO.EBEdge.RIGHT_FACE_EDGE) {
              new_active_corner = Next(act_top_corner);
            } else {
              new_active_corner = Previous(act_top_corner);
            }
            // Convert the encoder split symbol id to decoder symbol id.
            let dec_split_id = num_encoded_symbols - enc_split_id - 1;
            topology_split_id.push(dec_split_id);
            split_active_corners.push(new_active_corner);
          }
        }
      }

      //ProcessInteriorEdges
      let ans_decoder_ = RansInitDecoder(eb_start_face_buffer,
                      eb_start_face_buffer_size, L_RANS_BASE);

      while (active_corner_stack.length > 0) {
        let corner_a = active_corner_stack_pop_back();
        let interior_face = RabsDescRead(ans_decoder_, eb_start_face_buffer_prob_zero);
        if (interior_face) {
          let corner_b = Previous(corner_a);
          while (PosOpposite(corner_b) >= 0) {
            let b_opp = PosOpposite(corner_b);
            corner_b = Previous(b_opp);
          }
          let corner_c = Next(corner_a);
          while (PosOpposite(corner_c) >= 0) {
            let c_opp = PosOpposite(corner_c);
            corner_c = Next(c_opp);
          }
          let new_corner = face_to_vertex[0].length * 3;
          SetOppositeCorners(new_corner, corner_a);
          SetOppositeCorners(new_corner + 1, corner_b);
          SetOppositeCorners(new_corner + 2, corner_c);

          let next_a = CornerToVerts(0, corner_a)[1];
          let next_b = CornerToVerts(0, corner_b)[1];
          let next_c = CornerToVerts(0, corner_c)[1];
          MapCornerToVertex(new_corner, next_b);
          MapCornerToVertex(new_corner + 1, next_c);
          MapCornerToVertex(new_corner + 2, next_a);
          face_to_vertex[0].push(next_b);
          face_to_vertex[1].push(next_c);
          face_to_vertex[2].push(next_a);

          // Mark all three vertices as interior.
          is_vert_hole_[next_b] = false;
          is_vert_hole_[next_c] = false;
          is_vert_hole_[next_a] = false;
        }
      }

      if (version < 0x202) {
        dracoOffset += topology_split_decoded_bytes;
      }
    }
    else {
      throw new Error('Unknown encoder method '+encoder_method);
    }

    res.connectivitySize = dracoOffset - dracoOffset0;
    dracoOffset0 = dracoOffset;

    // DecodeAttributeData()

    res.attributeSize = dracoData.byteLength - dracoOffset0;

    return res;
  }
}
