using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

namespace AntiTokenSetup.Services
{
    public static class JsonHelper
    {
        private static JavaScriptSerializer CreateSerializer()
        {
            return new JavaScriptSerializer
            {
                MaxJsonLength = int.MaxValue,
                RecursionLimit = 256
            };
        }

        public static Dictionary<string, object> DeserializeObject(string json)
        {
            var result = CreateSerializer().Deserialize<Dictionary<string, object>>(json);
            return result ?? new Dictionary<string, object>(StringComparer.Ordinal);
        }

        public static string SerializeCompact(object value)
        {
            return CreateSerializer().Serialize(value);
        }

        public static string GetString(IDictionary<string, object> dict, string key, string fallback = "")
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val != null)
            {
                return Convert.ToString(val, CultureInfo.InvariantCulture) ?? fallback;
            }
            return fallback;
        }

        public static int GetInt(IDictionary<string, object> dict, string key, int fallback = 0)
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val != null)
            {
                try { return Convert.ToInt32(val, CultureInfo.InvariantCulture); }
                catch { return fallback; }
            }
            return fallback;
        }

        public static long GetLong(IDictionary<string, object> dict, string key, long fallback = 0)
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val != null)
            {
                try { return Convert.ToInt64(val, CultureInfo.InvariantCulture); }
                catch { return fallback; }
            }
            return fallback;
        }

        public static bool GetBool(IDictionary<string, object> dict, string key, bool fallback = false)
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val is bool b)
            {
                return b;
            }
            return fallback;
        }

        public static Dictionary<string, object> GetObject(IDictionary<string, object> dict, string key)
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val is Dictionary<string, object> sub)
            {
                return sub;
            }
            return null;
        }

        public static string SerializePretty(object value)
        {
            var sb = new StringBuilder();
            WritePrettyValue(value, sb, 0);
            sb.Append('\n');
            return sb.ToString();
        }

        private static void WritePrettyValue(object value, StringBuilder sb, int indent)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }

            if (value is string s)
            {
                WriteJsonString(s, sb);
                return;
            }

            if (value is bool b)
            {
                sb.Append(b ? "true" : "false");
                return;
            }

            if (value is int || value is long || value is short || value is byte ||
                value is uint || value is ulong || value is decimal || value is double || value is float)
            {
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }

            if (value is IDictionary<string, object> dict)
            {
                if (dict.Count == 0)
                {
                    sb.Append("{}");
                    return;
                }

                sb.Append("{\n");
                int idx = 0;
                foreach (var kv in dict)
                {
                    sb.Append(' ', (indent + 1) * 2);
                    WriteJsonString(kv.Key, sb);
                    sb.Append(": ");
                    WritePrettyValue(kv.Value, sb, indent + 1);
                    if (++idx < dict.Count) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(' ', indent * 2);
                sb.Append('}');
                return;
            }

            if (value is IEnumerable enumerable)
            {
                var items = new List<object>();
                foreach (var item in enumerable) items.Add(item);
                if (items.Count == 0)
                {
                    sb.Append("[]");
                    return;
                }

                sb.Append("[\n");
                for (int i = 0; i < items.Count; i++)
                {
                    sb.Append(' ', (indent + 1) * 2);
                    WritePrettyValue(items[i], sb, indent + 1);
                    if (i + 1 < items.Count) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(' ', indent * 2);
                sb.Append(']');
                return;
            }

            WriteJsonString(Convert.ToString(value, CultureInfo.InvariantCulture) ?? "", sb);
        }

        private static void WriteJsonString(string s, StringBuilder sb)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
