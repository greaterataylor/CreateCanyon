import importlib.util, io, pathlib, sys, tempfile, unittest, zipfile, tarfile, stat, gzip, dataclasses
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('archive_guard',ROOT/'processors'/'archive_guard.py')
g=importlib.util.module_from_spec(spec);sys.modules[spec.name]=g;spec.loader.exec_module(g)
class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def zip(self,entries,compression=zipfile.ZIP_STORED):
  p=self.root/'payload.zip'
  with zipfile.ZipFile(p,'w',compression=compression) as z:
   for name,data in entries:z.writestr(name,data)
  return p
 def inspect(self,p,**limits):return g.inspect_archive(p,self.root/'out',g.Limits(**limits))
 def test_valid_manifest_and_hash(self):
  r=self.inspect(self.zip([('src/readme.txt',b'hello'),('data.csv',b'a,b\n1,2\n')]))
  self.assertEqual(r['entries'],2);self.assertEqual(r['expandedBytes'],13);self.assertEqual((self.root/'out/src/readme.txt').read_bytes(),b'hello')
 def test_unsafe_names(self):
  for name in ['../x','a/../../x','/etc/passwd','C:/x','a\\b','a//b','a/./b','a:stream','CON.txt','a /x','a.','nul','a\x01b','word/vbaProject.bin','word/embeddings/object.bin']:
   with self.subTest(name=name):self.assertRaises(g.UnsafeArchive,g.safe_name,name)
 def test_case_collision(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('README',b'1'),('readme',b'2')]))
 def test_entry_limit(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('a',b'1'),('b',b'2')]),max_entries=1)
 def test_expanded_limit(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('a',b'12345678')]),max_uncompressed=7)
 def test_member_limit(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('a',b'12345678')]),max_file=7)
 def test_compression_ratio(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('bomb',b'A'*100000)],zipfile.ZIP_DEFLATED),max_ratio=10)
 def test_zip_symlink(self):
  link=zipfile.ZipInfo('link');link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([(link,b'/etc/passwd')]))
 def test_tar_links_devices_and_sparse(self):
  for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.CHRTYPE,tarfile.BLKTYPE,tarfile.FIFOTYPE]:
   with self.subTest(kind=kind):
    p=self.root/('test'+kind.decode()+'.tar')
    with tarfile.open(p,'w') as a:
     info=tarfile.TarInfo('special');info.type=kind;info.linkname='/etc/passwd';a.addfile(info)
    with self.assertRaises(g.UnsafeArchive):g.inspect_archive(p,self.root/('out'+kind.decode()))
 def test_path_depth(self):
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('a/b/c.txt',b'x')]),max_path_depth=2)
 def test_nested_depth(self):
  inner=io.BytesIO()
  with zipfile.ZipFile(inner,'w') as z:z.writestr('safe.txt','hello')
  with self.assertRaises(g.UnsafeArchive):self.inspect(self.zip([('inner.zip',inner.getvalue())]),max_archive_depth=1)
 def test_nested_manifest(self):
  inner=io.BytesIO()
  with zipfile.ZipFile(inner,'w') as z:z.writestr('safe.txt','hello')
  r=self.inspect(self.zip([('inner.zip',inner.getvalue())]));self.assertEqual(r['entries'],2);self.assertTrue(any(x['path']=='inner.zip!/safe.txt' for x in r['files']))
 def test_gzip_stream_limit(self):
  p=self.root/'large.gz';p.write_bytes(gzip.compress(b'A'*100000))
  with self.assertRaises(g.UnsafeArchive):self.inspect(p,max_uncompressed=1024)
 def test_nonarchive_is_not_executed(self):
  p=self.root/'payload';p.write_bytes(b'#!/bin/sh\ntouch /tmp/DO_NOT_EXECUTE\n');r=self.inspect(p);self.assertIsNone(r['archive']);self.assertEqual(r['entries'],0)
 def test_zip_crc_rejected(self):
  p=self.zip([('a.txt',b'hello world')]);data=bytearray(p.read_bytes());at=data.index(b'hello world');data[at]^=1;p.write_bytes(data)
  with self.assertRaises(zipfile.BadZipFile):self.inspect(p)
 def test_encrypted_flag_rejected(self):
  p=self.zip([('a.txt',b'test')]);data=bytearray(p.read_bytes());central=data.index(b'PK\x01\x02');data[6]|=1;data[central+8]|=1;p.write_bytes(data)
  with self.assertRaises(g.UnsafeArchive):self.inspect(p)
if __name__=='__main__':unittest.main()
